// /api/producto.js
// Sirve la página de producto con meta tags Open Graph ya rellenas en el servidor,
// para que WhatsApp/Instagram/Facebook muestren la foto y precio real al compartir el link.

const FIREBASE_PROJECT_ID = 'yanbal-store-masoco';

function fmtPrice(n) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(n || 0);
}

// Convierte el formato "fields" de Firestore REST API a un objeto JS plano
function parseFirestoreFields(fields) {
  const result = {};
  for (const key in fields) {
    const val = fields[key];
    if (val.stringValue !== undefined) result[key] = val.stringValue;
    else if (val.integerValue !== undefined) result[key] = parseInt(val.integerValue, 10);
    else if (val.doubleValue !== undefined) result[key] = val.doubleValue;
    else if (val.booleanValue !== undefined) result[key] = val.booleanValue;
    else if (val.arrayValue !== undefined) {
      result[key] = (val.arrayValue.values || []).map(v => {
        if (v.stringValue !== undefined) return v.stringValue;
        if (v.integerValue !== undefined) return parseInt(v.integerValue, 10);
        return null;
      });
    } else if (val.nullValue !== undefined) result[key] = null;
  }
  return result;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = async (req, res) => {
  const id = req.query.id;

  if (!id) {
    res.status(400).send('Falta el parámetro id');
    return;
  }

  const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/products/${id}`;

  let product = null;
  try {
    const fsRes = await fetch(firestoreUrl);
    if (fsRes.ok) {
      const doc = await fsRes.json();
      if (doc.fields) {
        product = parseFirestoreFields(doc.fields);
        product.id = id;
      }
    }
  } catch (e) {
    // Si falla la consulta, seguimos con product = null y mostramos estado de error
  }

  const siteUrl = `https://${req.headers.host}`;
  const canonicalUrl = `${siteUrl}/producto/${id}`;      // la URL que se comparte y que evalúa el Debugger
  const productUrl = `${siteUrl}/producto.html?id=${id}`; // a donde se redirige al humano

  if (!product || product.active === false) {
    // Producto no encontrado: redirigimos al catálogo general
    res.writeHead(302, { Location: '/index.html' });
    res.end();
    return;
  }

  const imgs = (product.imageUrls && product.imageUrls.length) ? product.imageUrls : (product.imageUrl ? [product.imageUrl] : []);
  const mainImg = imgs[0] || `${siteUrl}/LogoM.png`;
  const hasOffer = product.originalPrice && product.originalPrice > product.price;
  const discount = hasOffer ? Math.round((1 - (product.price / product.originalPrice)) * 100) : 0;

  const priceLine = hasOffer
    ? `${fmtPrice(product.price)} (antes ${fmtPrice(product.originalPrice)}, -${discount}%)`
    : fmtPrice(product.price);

  const description = product.description
    ? `${priceLine} — ${product.description}`
    : `${priceLine} — Disponible en Maida Store`;

  const name = product.name || 'Producto';

  // Redirige inmediatamente a la versión interactiva (producto.html),
  // pero como esta respuesta ya trae las meta tags correctas,
  // los bots de redes sociales las leen ANTES de seguir el redirect.
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${escapeHtml(name)} · Maida Store</title>
  <meta name="description" content="${escapeHtml(description)}"/>

  <meta property="og:title" content="${escapeHtml(name)} · Maida Store"/>
  <meta property="og:description" content="${escapeHtml(description)}"/>
  <meta property="og:image" content="${escapeHtml(mainImg)}"/>
  <meta property="og:image:secure_url" content="${escapeHtml(mainImg)}"/>
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}"/>
  <meta property="og:site_name" content="Maida Store"/>
  <meta property="og:type" content="product"/>

  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${escapeHtml(name)} · Maida Store"/>
  <meta name="twitter:description" content="${escapeHtml(description)}"/>
  <meta name="twitter:image" content="${escapeHtml(mainImg)}"/>

  <meta http-equiv="refresh" content="0; url=${escapeHtml(productUrl)}" />
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
</head>
<body>
  <p>Redirigiendo a <a href="${escapeHtml(productUrl)}">${escapeHtml(name)}</a>…</p>
  <script>window.location.replace(${JSON.stringify(productUrl)});</script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Cachea la respuesta un poco para no golpear Firestore en cada scrape de un bot
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
  res.status(200).send(html);
};
