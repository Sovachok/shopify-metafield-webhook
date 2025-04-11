const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;

if (!SHOPIFY_ACCESS_TOKEN || !SHOPIFY_STORE_DOMAIN) {
  console.error('❌ Переменные окружения не заданы. Завершаем работу...');
  process.exit(1);
}

const clean = (str) => str.replace(/<[^>]*>/g, '').trim();

app.post('/', async (req, res) => {
  const order = req.body.order;
  console.log('🟡 Получен новый webhook на заказ:', order?.id || '[без ID]');

  if (!order || !order.line_items) {
    console.error('❌ Невалидные данные заказа:', req.body);
    return res.status(400).json({ error: 'Invalid order data' });
  }

  let lines = ['📦 Product Info:'];

  for (const item of order.line_items) {
    const productId = item.product_id;
    const quantity = item.quantity || 1;
    console.log(`🔍 Обработка товара: ${item.title} (ID: ${productId})`);

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
      console.log(`✅ Получены метафилды для продукта ${productId}:`, metafields);

      const rawSubheading = metafields.find(
        (m) => m.namespace === 'subheading' && m.key === 'swd'
      )?.value || '—';

      const rawWeight = metafields.find(
        (m) => m.namespace === 'weight' && m.key === 'wgt'
      )?.value || '—';

      const subheading = clean(rawSubheading);
      const weight = clean(rawWeight);

      lines.push(`- ${item.title} ×${quantity} | ${subheading} | ${weight}`);
    } catch (err) {
      console.error(`⚠️ Ошибка загрузки метафилдов для товара ${productId}:`, err.response?.data || err.message);
      lines.push(`- ${item.title} ×${quantity} | (метафилды недоступны)`);
    }
  }

  const combinedNote = `${
    order.note ? '📝 Customer Note:\n' + order.note + '\n\n' : ''
  }${lines.join('\n')}`;

  console.log(`📤 Обновление заметки заказа ${order.id}:\n${combinedNote}`);

  try {
    const response = await axios.put(
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

    console.log(`✅ Заметка успешно обновлена для заказа ${order.id}`);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('❌ Ошибка при обновлении заказа:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to update order note' });
  }
});

app.listen(3000, () => {
  console.log('🚀 Webhook server is running on port 3000');
});
