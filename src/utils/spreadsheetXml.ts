import { SaxesParser } from 'saxes';
import type { ExcelCell, ParsedWorkbook } from './excelWorkbook';

const NS = 'urn:schemas-microsoft-com:office:spreadsheet';
/** SpreadsheetML exports are XML even when their extension is .xls. Works in the import worker. */
export function parseSpreadsheetXml(text: string): ParsedWorkbook {
  const rowsBySheet: Record<string, ExcelCell[][]> = Object.create(null);
  const parser = new SaxesParser({ xmlns: true });
  let sheet = '', row: ExcelCell[] | null = null, column = 0, type = '', value = '', reading = false, cells = 0;
  let workbook = false;
  const index = (v: string | undefined, fallback: number, max: number) => {
    if (v === undefined) return fallback;
    const n = Number(v);
    if (!Number.isInteger(n) || n < fallback + 1 || n > max) throw new Error('شماره سطر یا ستون XML نامعتبر است.');
    return n - 1;
  };
  parser.on('doctype', () => { throw new Error('تعریف DTD در فایل اکسل مجاز نیست.'); });
  parser.on('error', () => { throw new Error('ساختار XML فایل اکسل معتبر نیست.'); });
  parser.on('opentag', tag => {
    if (tag.uri !== NS) return;
    const attribute = (name: string) => Object.values(tag.attributes).find(a => a.uri === NS && a.local === name)?.value;
    if (tag.local === 'Workbook') workbook = true;
    if (tag.local === 'Worksheet') {
      sheet = attribute('Name') || '';
      if (!sheet || rowsBySheet[sheet]) throw new Error('نام شیت XML خالی یا تکراری است.');
      rowsBySheet[sheet] = [];
    } else if (tag.local === 'Row') {
      if (!sheet) throw new Error('سطر XML خارج از شیت است.');
      const rows = rowsBySheet[sheet];
      const target = index(attribute('Index'), rows.length, 100000);
      while (rows.length < target) rows.push([]);
      if (rows.length >= 100000) throw new Error('تعداد سطرهای فایل بیش از حد مجاز است.');
      row = []; column = 0; rows.push(row);
    } else if (tag.local === 'Cell') {
      if (!row || ++cells > 2000000) throw new Error('تعداد یا ساختار سلول‌های XML نامعتبر است.');
      column = index(attribute('Index'), column, 256);
      if (column >= 256) throw new Error('تعداد ستون‌های XML بیش از حد مجاز است.');
      value = ''; type = ''; row[column] = '';
    } else if (tag.local === 'Data') { reading = true; type = attribute('Type') || 'String'; value = ''; }
  });
  parser.on('text', t => { if (reading) value += t; });
  parser.on('cdata', t => { if (reading) value += t; });
  parser.on('closetag', tag => {
    if (tag.uri !== NS) return;
    if (tag.local === 'Data') {
      reading = false;
      if (!row) throw new Error('داده XML خارج از سطر است.');
      if (type === 'Number') {
        const n = Number(value);
        if (!value.trim() || !Number.isFinite(n)) throw new Error('مقدار عددی XML معتبر نیست.');
        row[column] = n;
      } else if (type === 'Boolean') {
        if (value !== '0' && value !== '1') throw new Error('مقدار منطقی XML معتبر نیست.');
        row[column] = value === '1';
      } else row[column] = value;
    } else if (tag.local === 'Cell') column++;
    else if (tag.local === 'Row') row = null;
    else if (tag.local === 'Worksheet') sheet = '';
  });
  // Streaming chunks avoid a second complete XML/tree representation in memory.
  for (let offset = 0; offset < text.length; offset += 65536) parser.write(text.slice(offset, offset + 65536));
  parser.close();
  const sheets = Object.keys(rowsBySheet);
  if (!workbook || !sheets.length) throw new Error('فایل، XML Spreadsheet اکسل نیست.');
  return { sheets, rowsBySheet };
}
