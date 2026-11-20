-- Données de démonstration : 20 restaurants, 160 plats, 200 utilisateurs,
-- 5 000 commandes (étape 1 du TP). Déterministe : deux exécutions donnent
-- les mêmes affectations (seules les dates dépendent de l'heure d'exécution).
--
-- ATTENTION : vide toutes les tables avant d'insérer.
-- Exécuté en un seul bloc, donc dans une seule transaction implicite.

TRUNCATE payments, order_items, orders, dishes, restaurants, users;

-- Restaurants ---------------------------------------------------------------
INSERT INTO restaurants (name)
SELECT (ARRAY[
  'Chez Marcel', 'Pizza Napoli', 'Sushi Kaze', 'Le Bouchon Lyonnais',
  'Burger Factory', 'Tacos del Sol', 'Pho Saigon', 'Le Couscous Royal',
  'Thai Orchid', 'Curry House', 'La Crêperie Bretonne', 'Falafel Express',
  'Poke Bowl Co', 'Le Petit Grec', 'Ramen Ichiban', 'Trattoria Roma',
  'Kebab Istanbul', 'Green Salad Bar', 'Dumpling Palace', 'Le Croque Monsieur'
])[n]
FROM generate_series(1, 20) AS n;

-- Plats : 8 par restaurant, prix légèrement différents selon le restaurant -----
CREATE TEMP TABLE seed_restaurants AS
SELECT id, row_number() OVER (ORDER BY name) AS rn FROM restaurants;

INSERT INTO dishes (restaurant_id, name, price_cents)
SELECT r.id, m.name, m.price_cents + (r.rn % 5) * 50
FROM seed_restaurants r
CROSS JOIN (VALUES
  ('Entrée du jour',  690),
  ('Salade composée', 890),
  ('Plat signature', 1490),
  ('Plat végétarien', 1290),
  ('Menu enfant',      790),
  ('Dessert maison',   590),
  ('Boisson',          290),
  ('Menu complet',    1990)
) AS m(name, price_cents);

CREATE TEMP TABLE seed_dishes AS
SELECT d.id, d.restaurant_id, d.name, d.price_cents,
       row_number() OVER (PARTITION BY d.restaurant_id ORDER BY d.price_cents, d.name) AS rk
FROM dishes d;

-- Utilisateurs (hash factice, jamais un vrai mot de passe) ---------------------
INSERT INTO users (first_name, email, phone, password_hash)
SELECT (ARRAY['Léa','Hugo','Emma','Louis','Chloé','Lucas','Jade','Nathan',
              'Manon','Ethan','Inès','Noah'])[1 + n % 12],
       'user' || n || '@example.test',
       '+336' || lpad(n::text, 8, '0'),
       '$seed$not-a-real-hash$' || md5(n::text)
FROM generate_series(1, 200) AS n;

CREATE TEMP TABLE seed_users AS
SELECT id, row_number() OVER (ORDER BY email) AS rn FROM users;

-- Commandes : 5 000, réparties sur 90 jours, la plus ancienne en premier --------
-- Le jitter est soustrait (jamais de date dans le futur). L'id est un UUIDv7 décalé jusqu'à created_at : l'ordre des id suit l'ordre
-- chronologique, ce qui rend le curseur (id DESC) cohérent avec created_at.
SELECT setseed(0.42);

CREATE TEMP TABLE seed_orders AS
SELECT n,
       uuidv7(ts - now()) AS id,
       u.id AS user_id,
       r.id AS restaurant_id,
       ts AS created_at,
       (n % 10 < 6) AS paid
FROM (
  SELECT n,
         now() - interval '90 days' * (1 - n / 5000.0)
               - random() * interval '20 minutes' AS ts
  FROM generate_series(1, 5000) AS n
) g
JOIN seed_users u       ON u.rn = 1 + (g.n * 7919)   % 200
JOIN seed_restaurants r ON r.rn = 1 + (g.n * 104729) % 20;

INSERT INTO orders (id, user_id, restaurant_id, status, total_cents, created_at)
SELECT id, user_id, restaurant_id,
       CASE WHEN paid THEN 'paid'::order_status ELSE 'pending'::order_status END,
       0,
       created_at
FROM seed_orders
ORDER BY n;

-- Lignes de commande : 1 à 4 plats distincts par commande ------------------------
INSERT INTO order_items (order_id, dish_id, name, quantity, unit_price_cents)
SELECT o.id, d.id, d.name, 1 + (o.n + k) % 3, d.price_cents
FROM seed_orders o
CROSS JOIN LATERAL generate_series(1, 1 + o.n % 4) AS k
JOIN seed_dishes d
  ON d.restaurant_id = o.restaurant_id
 AND d.rk = 1 + (o.n + k * 3) % 8;

UPDATE orders o
SET total_cents = t.total
FROM (
  SELECT order_id, sum(quantity * unit_price_cents) AS total
  FROM order_items
  GROUP BY order_id
) t
WHERE t.order_id = o.id;

-- Paiements des commandes payées -------------------------------------------------
INSERT INTO payments (order_id, idempotency_key, method, status, amount_cents, currency, created_at)
SELECT o.id, 'seed-' || o.id, 'card', 'succeeded', o.total_cents, o.currency,
       o.created_at + interval '1 minute'
FROM orders o
WHERE o.status = 'paid';
