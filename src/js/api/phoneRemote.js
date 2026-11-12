// Só o gerador de QR code (data URL, preto no branco, para qualquer câmera ler). Hoje quem usa é o
// perfil do elenco (Instagram). O controle pelo celular que morava aqui foi removido.
import qrcode from 'qrcode-generator';

export function qrDataUrl(text, cellSize) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(cellSize || 8, 2);
}
