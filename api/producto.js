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

// Genera un slug legible a partir del nombre del producto: minúsculas, sin tildes,
// espacios y símbolos convertidos a guiones. DEBE ser idéntica a la función slugify()
// usada en producto.html y en el workflow de n8n (nodo "Extraer Copy"), para que
// los links generados en cualquiera de los tres lugares apunten al mismo producto.
function slugify(text) {
  return (text || '')
    .toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita tildes
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')  // quita símbolos raros
    .replace(/\s+/g, '-')          // espacios -> guiones
    .replace(/-+/g, '-');          // colapsa guiones repetidos
}

module.exports = async (req, res) => {
  const slug = req.query.slug;
  const idParam = req.query.id; // compatibilidad con links viejos ?id=...

  if (!slug && !idParam) {
    res.status(400).send('Falta el parámetro slug o id');
    return;
  }

  let product = null;

  try {
    if (idParam) {
      // Formato viejo: búsqueda directa por documento, más rápida.
      const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/products/${idParam}`;
      const fsRes = await fetch(firestoreUrl);
      if (fsRes.ok) {
        const doc = await fsRes.json();
        if (doc.fields) {
          product = parseFirestoreFields(doc.fields);
          product.id = idParam;
        }
      }
    } else {
      // Formato nuevo: traemos productos activos y buscamos por slug generado al vuelo,
      // ya que Firestore no tiene un campo 'slug' propio.
      const listUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/products`;
      const fsRes = await fetch(listUrl);
      if (fsRes.ok) {
        const data = await fsRes.json();
        const documents = data.documents || [];
        const products = documents.map(doc => {
          const fields = parseFirestoreFields(doc.fields);
          const docId = doc.name.split('/').pop();
          return { id: docId, ...fields };
        });
        product = products.find(p => p.active !== false && slugify(p.name) === slug) || null;
      }
    }
  } catch (e) {
    // Si falla la consulta, seguimos con product = null y mostramos estado de error
  }

  const siteUrl = `https://${req.headers.host}`;
  const finalSlug = product ? slugify(product.name) : (slug || '');
  const canonicalUrl = `${siteUrl}/producto/${finalSlug}`;         // la URL que se comparte y que evalúa el Debugger
  const productUrl = `${siteUrl}/producto.html?slug=${finalSlug}`; // a donde se redirige al humano

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

  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />

  <style>
    body { font-family: sans-serif; background:#faf7f4; color:#2a2220; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; text-align:center; padding:20px; }
    a.btn { display:inline-block; margin-top:16px; background:#c9736a; color:white; text-decoration:none; padding:14px 28px; border-radius:50px; font-weight:600; }
    img.preview { max-width:200px; border-radius:12px; margin-bottom:16px; }
  </style>
</head>
<body>
  <div>
    <img class="preview" src="${escapeHtml(mainImg)}" alt="${escapeHtml(name)}" />
    <h1>${escapeHtml(name)}</h1>
    <p>${escapeHtml(priceLine)}</p>
    <a class="btn" href="${escapeHtml(productUrl)}">Ver producto →</a>
  </div>
  <script>window.location.replace(${JSON.stringify(productUrl)});</script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Cachea la respuesta un poco para no golpear Firestore en cada scrape de un bot
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
  res.status(200).send(html);
};
