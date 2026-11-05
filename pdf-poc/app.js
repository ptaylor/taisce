import { markdownToPdf } from '../js/pdf.js';

const $ = (selector) => document.querySelector(selector);
const drop = $('#drop');
const fileInput = $('#file');
const result = $('#result');
const status = $('#status');
const download = $('#download');

let objectUrl = null;
let job = 0;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function pdfName(name) {
  const base = String(name || 'note').replace(/\.(?:md|markdown)$/i, '');
  return `${base || 'note'}.pdf`;
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function clearResult() {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
  result.hidden = true;
  download.removeAttribute('href');
}

async function convert(file) {
  if (!file) return;

  const current = ++job;
  clearResult();
  setStatus('Reading the file…');

  try {
    const text = await file.text();
    if (current !== job) return;
    if (!text.trim()) {
      setStatus('That file is empty.', true);
      return;
    }

    // Give the status a chance to paint before the synchronous layout.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (current !== job) return;
    setStatus('Laying out the page…');

    const started = performance.now();
    const bytes = markdownToPdf(text, {
      title: file.name.replace(/\.(?:md|markdown)$/i, '') || 'Untitled',
    });
    const elapsed = performance.now() - started;

    const blob = new Blob([bytes], { type: 'application/pdf' });
    objectUrl = URL.createObjectURL(blob);
    download.href = objectUrl;
    download.download = pdfName(file.name);
    $('#file-name').textContent = file.name;
    $('#file-size').textContent = `${formatBytes(file.size)} in`;
    $('#stats').textContent = `${formatBytes(blob.size)} PDF · ${elapsed.toFixed(0)} ms`;
    result.hidden = false;
    setStatus('Ready.');
  } catch (error) {
    console.error(error);
    setStatus(`Could not make a PDF: ${error.message || 'unknown error'}`, true);
  }
}

function chooseFile() {
  fileInput.click();
}

$('#pick').addEventListener('click', chooseFile);

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  // Clearing the input lets the same file be chosen again on a later attempt.
  fileInput.value = '';
  convert(file);
});

for (const type of ['dragenter', 'dragover']) {
  drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.add('over');
  });
}

for (const type of ['dragleave', 'drop']) {
  drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.remove('over');
  });
}

drop.addEventListener('drop', (event) => {
  convert(event.dataTransfer?.files?.[0]);
});

// A file dropped outside the panel must not navigate away from the app.
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

window.addEventListener('pagehide', () => {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
});
