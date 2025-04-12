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

  let lines = ['📦 Product Info:'];

  for (const item of order.line_items) {
    const productId = item.product_id;

    try {
      const metafieldsResp = await axios.get(
        `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/products/${productId}/metafields.json`,
        {
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
            'Content-Type': 'application/json',
          },
        }
      );

      const metafields = metafieldsResp.data.metafields;
      const subheading = metafields.find(
        (m) => m.namespace === 'subheading' && m.key === 'swd'
      )?.value || '—';

      const weight = metafields.find(
        (m) => m.namespace === 'weight' && m.key === 'wgt'
      )?.value || '—';

      const qty = String(item.quantity).padStart(2, '\u2007'); // U+2007 — фиксированный пробел (фигурный)
      lines.push(`×${qty} | ${subheading} | ${weight}`);
    } catch (err) {
      lines.push(`×${item.quantity} | ${item.title} | (метафилды недоступны)`);
    }
  }

  const combinedNote = `${
    order.note ? '📝 Customer Note:\n' + order.note + '\n\n' : ''
  }${lines.join('\n')}`;

  try {
    await axios.put(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/orders/${order.id}.json`,
      {
        order: {
          id: order.id,
          note: combinedNote,
        },
      },
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('✅ Order note updated successfully.');
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('❌ Ошибка при обновлении заказа:', err.message);
    res.status(500).json({ error: 'Failed to update order note' });
  }
});

app.listen(3000, () => {
  console.log('Webhook server is running on port 3000');
});
