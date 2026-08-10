// Builds the PDF fixtures the reading tests import.
//
// Written by hand rather than pulled from a library so the repository carries
// no dependency for it, and so the two cases the importer actually has to tell
// apart -- a file that declares its title and author, and the far more common
// one that declares nothing -- are exactly what the fixtures are.
//
//   node scripts/make-pdf-fixtures.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'tests', 'e2e', 'fixtures');

function buildPdf({ pages, info = {} }) {
  const objects = [];
  const push = (body) => {
    objects.push(body);
    return objects.length; // 1-based object number
  };

  // Object numbers are allocated up front so the page tree can point at pages
  // that have not been written yet.
  const catalogNum = 1;
  const pagesNum = 2;
  const fontNum = 3;
  let next = 4;
  const pageNums = pages.map(() => ({ page: next++, content: next++ }));
  const infoNum = next++;

  objects.length = 0;
  push(`<< /Type /Catalog /Pages ${pagesNum} 0 R >>`);
  push(`<< /Type /Pages /Kids [${pageNums.map((p) => `${p.page} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  for (const [index, label] of pages.entries()) {
    const { page, content } = pageNums[index];
    const stream = `BT /F1 24 Tf 40 300 Td (${label.replace(/[()\\]/g, '')}) Tj ET`;
    // Objects are written in order, so pad the array to the right slots.
    objects[page - 1] =
      `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 300 400] ` +
      `/Resources << /Font << /F1 ${fontNum} 0 R >> >> /Contents ${content} 0 R >>`;
    objects[content - 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }

  const infoEntries = Object.entries(info)
    .map(([key, value]) => `/${key} (${String(value).replace(/[()\\]/g, '')})`)
    .join(' ');
  objects[infoNum - 1] = infoEntries ? `<< ${infoEntries} >>` : '<< >>';

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNum} 0 R` +
    `${infoEntries ? ` /Info ${infoNum} 0 R` : ''} >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

mkdirSync(out, { recursive: true });

writeFileSync(
  join(out, 'described.pdf'),
  buildPdf({
    pages: ['Page one', 'Page two', 'Page three', 'Page four'],
    info: { Title: 'The Rings of Saturn', Author: 'W G Sebald' },
  }),
);

// The common case: a scanner or a LaTeX run that wrote nothing at all, so the
// importer has only the filename to work from.
writeFileSync(
  join(out, 'Kent Beck - Test Driven Development.pdf'),
  buildPdf({ pages: ['One', 'Two'], info: {} }),
);

console.log(`wrote fixtures to ${out}`);
