const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;

app.post('/', async (req, res) => {
  const order = req.body.order;
  if (!order || !order.line_items) {
    return res.status(400).json({ error: 'Invalid order data' });
  }

  let lines = ['Product info:'];
  for (const item of order.line_items) {
    const productId = item.product_id;
    try {
      const response = await axios.get(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/products/${productId}.json`, {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      });

      const product = response.data.product;
      const metafieldsResp = await axios.get(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/products/${productId}/metafields.json`, {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
        }
      });

      const metafields = metafieldsResp.data.metafields;
      const subheading = metafields.find(m => m.namespace === 'subheading' && m.key === 'swd')?.value || '—';
      const weight = metafields.find(m => m.namespace === 'weight' && m.key === 'wgt')?.value || '—';

      lines.push(`- ${item.title} | ${subheading} | ${weight}`);
    } catch (err) {
      lines.push(`- ${item.title} | (ошибка загрузки метафилдов)`);
    }
  }

  const noteText = lines.join('\n');
  res.json({ note: noteText });
});

app.listen(3000, () => {
  console.log('Webhook server is running on port 3000');
});
