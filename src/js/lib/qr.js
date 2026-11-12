// Gerador de QR code (data URL, preto no branco, para qualquer câmera ler). Hoje usado no perfil do elenco.
import qrcode from 'qrcode-generator';

export function qrDataUrl(text, cellSize) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(cellSize || 8, 2);
}
