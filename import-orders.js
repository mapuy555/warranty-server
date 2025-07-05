const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
const parse = require("csv-parse/sync").parse;

// โหลด Firebase Admin SDK
const serviceAccount = require("./warranty-register-53b10-firebase-adminsdk-fbsvc-26757ab022.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// โหลดข้อมูลจาก CSV
const csvFilePath = path.resolve(__dirname, "orders.csv");
const csvData = fs.readFileSync(csvFilePath, "utf8");

// แปลง CSV เป็น JSON
const orders = parse(csvData, {
  columns: true,
  skip_empty_lines: true,
});

async function importOrders() {
  for (const order of orders) {
    const {
      orderId,
      productName,
      purchaseDate,
      productType,
    } = order;

    const dateObj = new Date(purchaseDate); // แปลงวันที่

    await db.collection("orders").doc(orderId).set({
      orderId,
      productName,
      productType,
      purchaseDate: admin.firestore.Timestamp.fromDate(dateObj)
    });

    console.log(`✅ Imported: ${orderId}`);
  }

  console.log("🎉 เสร็จสิ้นการ import CSV เข้า Firestore");
}

importOrders().catch(console.error);
