export default function create({openLink}) {
  return {callbacks: {home: () => openLink('/')}};
}
