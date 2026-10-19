/** Download an already authorized CSV without changing its BOM, contents or audit identity. */
export function downloadCsv(file: { csv: string; filename: string }) {
  const url = URL.createObjectURL(new Blob([file.csv], { type: 'text/csv;charset=utf-8' }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = file.filename;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
