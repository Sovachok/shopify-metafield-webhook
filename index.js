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
  const order = req.body.order || req.body;
  console.log('🟡 Получен новый webhook на заказ:', order?.id || '[без ID]');

  if (!order || !Array.isArray(order.line_items) || order.line_items.length === 0) {
    console.log('⚠️ Пропущен заказ: нет товаров');
    return res.status(200).send('No items to process');
  }

  let realOrdersCount = 0;

  if (order.customer?.id) {
    try {
      const ordersResp = await axios.get(
        `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/orders.json?customer_id=${order.customer.id}&status=any`,
        {
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
            'Content-Type': 'application/json',
          },
        }
      );
      realOrdersCount = ordersResp.data.orders.length;
      console.log(`🔁 Реальное кол-во заказов у покупателя ${order.customer.id}: ${realOrdersCount}`);
    } catch (err) {
      console.warn(`⚠️ Ошибка при получении заказов покупателя ${order.customer.id}:`, err.response?.data || err.message);
    }
  } else {
    console.log('⚠️ У заказа отсутствует информация о клиенте');
  }

  let lines = [];

  // Добавляем буклет, если это первый заказ
  if (realOrdersCount === 1) {
    const langFromCustomer = (order.customer?.note || '').toLowerCase();
    const langFromOrder = (order.customer_locale || '').toLowerCase();
    const isHebrew =
      langFromCustomer.includes('hebrew') ||
      langFromCustomer.includes('עברית') ||
      langFromOrder.startsWith('he');

    lines.push(isHebrew ? '📄 Положить буклет на иврите' : '📄 Положить буклет на русском');
  }

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

      lines.push(`×${quantity} | ${subheading} | ${weight}`);
    } catch (err) {
      console.error(`⚠️ Ошибка загрузки метафилдов для товара ${productId}:`, err.response?.data || err.message);
      lines.push(`×${quantity} | (метафилды недоступны)`);
    }
  }


// ВСТАВИТЬ ВМЕСТО lines.push(`×${quantity} | ${subheading} | ${weight}`); ПОСЛЕ ЦИКЛА ПО ТОВАРАМ

// --- БЛОК: ВЫБОР ПРОБНИКА ---
try {
  const allPastProductIds = new Set();
  const allPastProductTitles = new Set();
  const collectionStats = {};

  // Собираем ID и названия всех товаров из прошлых заказов
  for (const pastOrder of ordersResp.data.orders) {
    for (const line of pastOrder.line_items || []) {
      if (line.product_id) {
        allPastProductIds.add(line.product_id);
      }
      if (line.title) {
        allPastProductTitles.add(line.title.toLowerCase().replace(/\|.*$/, '').trim());
      }
    }
  }

  console.log('📦 Все ранее заказанные товары:\n' + [...allPastProductTitles].join(', '));


  // Получаем коллекции всех товаров текущего заказа
  const collectionCounts = {};
  for (const item of order.line_items) {
    const productId = item.product_id;

    const productResp = await axios.get(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/products/${productId}/collections.json`,
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
      }
    );

    for (const collection of productResp.data.collections) {
      const id = collection.id;
      collectionCounts[id] = (collectionCounts[id] || 0) + item.quantity;
    }
  }

  // Находим любимую коллекцию по количеству заказанных товаров
  const favoriteCollectionId = Object.entries(collectionCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

  if (favoriteCollectionId) {
    // Получаем товары из любимой коллекции
    const collectResp = await axios.get(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/collects.json?collection_id=${favoriteCollectionId}&limit=250`,
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
      }
    );

    const productIdsInCollection = collectResp.data.collects.map(c => c.product_id);

    // Сортируем по количеству покупок каждого товара из коллекции
    const productStats = {};
    for (const pastOrder of ordersResp.data.orders) {
      for (const line of pastOrder.line_items || []) {
        const pid = line.product_id;
        if (productIdsInCollection.includes(pid)) {
          productStats[pid] = (productStats[pid] || 0) + line.quantity;
        }
      }
    }

    const sortedCandidates = [...new Set(productIdsInCollection)].sort((a, b) => (productStats[b] || 0) - (productStats[a] || 0));

    for (const candidateId of sortedCandidates.slice(0, 30)) {
      if (allPastProductIds.has(candidateId)) continue;

      const metaResp = await axios.get(
        `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/products/${candidateId}/metafields.json`,
        {
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
            'Content-Type': 'application/json',
          },
        }
      );

      const metas = metaResp.data.metafields;
      const subRaw = metas.find(m => m.namespace === 'subheading' && m.key === 'swd')?.value || '';
      const subCleaned = clean(subRaw);
      const subKey = subCleaned.toLowerCase().replace(/\|.*$/, '').trim();

      const hasMatcha = metas.some(m => m.value?.toLowerCase?.().includes('matcha'));

      if (!hasMatcha && !allPastProductTitles.has(subKey)) {
        lines.push(`🎁 Пробник: ${subCleaned}`);
        break;
      }
    }
  }
} catch (err) {
  console.warn('⚠️ Ошибка при подборе пробника:', err.message);
}


  // создание заметки
  
  const combinedNote = `${
    order.note ? '📝 Customer Note:\n' + order.note + '\n\n' : ''
  }${lines.join('\n\n')}`;

  console.log(`📤 Обновление заметки заказа ${order.id}:\n${combinedNote}`);

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
