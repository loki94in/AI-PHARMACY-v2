export function printCurrentBill(fileNameBase: string): void {
  const prevTitle = document.title;
  document.title = fileNameBase.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();
  document.body.classList.add('printing-bill');
  const restore = () => {
    document.title = prevTitle;
    document.body.classList.remove('printing-bill');
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  setTimeout(restore, 60000);
  window.print();
}
