// config/mailer.js — Transporter SMTP partagé
const nodemailer = require('nodemailer');

function createTransporter() {
  return nodemailer.createTransport({
    host             : process.env.SMTP_HOST,
    port             : parseInt(process.env.SMTP_PORT || '587'),
    secure           : false,
    ignoreTLS        : process.env.SMTP_NO_TLS === 'true',
    connectionTimeout: 10000,
    greetingTimeout  : 10000,
    socketTimeout    : 15000,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    tls: { rejectUnauthorized: false, ciphers: 'SSLv3' }
  });
}

function getCcList() {
  return process.env.SMTP_CC
    ? process.env.SMTP_CC.split(',').map(e => e.trim()).filter(Boolean)
    : [];
}

function getSender() {
  return `"${process.env.SMTP_FROM_NAME || 'Support ClicToPay'}" <${process.env.SMTP_FROM_ADDRESS || process.env.SMTP_USER}>`;
}

async function sendMail({ to, cc, subject, html, attachments }) {
  const transporter = createTransporter();
  const ccList      = cc || getCcList();

  const mailOptions = {
    from   : getSender(),
    to,
    cc     : ccList.length ? ccList.join(', ') : undefined,
    subject,
    html,
  };

  // Pièces jointes (optionnel)
  if (attachments && attachments.length > 0) {
    mailOptions.attachments = attachments.map(att => ({
      filename   : att.filename,
      content    : att.content,      // Buffer nodebuffer
      contentType: att.contentType,
    }));
    console.log(`[mailer] ${attachments.length} pièce(s) jointe(s) :`, attachments.map(a => `${a.filename} (${a.content?.length} bytes)`).join(', '));
  }

  return transporter.sendMail(mailOptions);
}

module.exports = { createTransporter, getCcList, getSender, sendMail };
