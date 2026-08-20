-- Optional reference schema. The Node.js server also creates these tables automatically.
CREATE DATABASE IF NOT EXISTS smart_vyapar;
USE smart_vyapar;
-- Start the server after setting backend/.env; it will create/verify all tables and seed a demo shop.
