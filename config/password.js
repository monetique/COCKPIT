// config/password.js — Génération de mots de passe sécurisés
function generatePassword() {
  const upper  = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower  = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const all    = upper + lower + digits;

  // Garantir au moins 1 de chaque type
  let pwd = [
    upper [Math.floor(Math.random() * upper.length)],
    lower [Math.floor(Math.random() * lower.length)],
    digits[Math.floor(Math.random() * digits.length)],
  ];

  // Compléter à 8 caractères
  for (let i = pwd.length; i < 8; i++) {
    pwd.push(all[Math.floor(Math.random() * all.length)]);
  }

  // Mélanger
  return pwd.sort(() => Math.random() - 0.5).join('');
}

module.exports = { generatePassword };
