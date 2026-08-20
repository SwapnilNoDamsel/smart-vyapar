# Smart Vyapar — Full Stack MySQL Edition

A ready-to-run version of the Helping Small Vendors Go Digital / Smart Vyapar project.

## Stack
- Frontend: HTML/CSS/JavaScript
- Backend: Node.js + Express
- Database: MySQL 8.4+

## 1. Configure MySQL
MySQL Server must be installed and running.

Inside `backend`, copy `.env.example` to `.env` and set your MySQL root password:

```env
PORT=5000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=YOUR_MYSQL_ROOT_PASSWORD
DB_NAME=smart_vyapar
```

The backend automatically creates the `smart_vyapar` database, tables, a demo vendor, a demo shop, and starter products.

## 2. Install backend packages
Open PowerShell in the `backend` folder:

```powershell
npm install
npm start
```

You should see:

```text
Smart Vyapar running at http://localhost:5000
MySQL database: smart_vyapar
```

## 3. Open the website

```text
http://localhost:5000
```

A published shop can be opened at:

```text
http://localhost:5000/shop/1
```

Newly published shops redirect automatically to `/shop/<shop-id>`.

## Important
- The UPI/QR payment flow is a project/demo status flow; it does not process real money.
- Do not commit your `.env` file or share your MySQL password.
- All shops, products, orders, stock, payments, dashboard values and reports are stored in MySQL rather than browser local storage.
