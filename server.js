require("dotenv").config(); // ต้องอยู่บรรทัดแรก

const express = require("express");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: "https://warranty-register-53b10.web.app"
}));
app.use(bodyParser.json());

// 🔐 Firebase Admin Init จาก Environment Variables (Base64)
const serviceAccount = JSON.parse(
  Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8")
);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// ✅ Helper
function calculateWarrantyUntil(days) {
  const today = new Date();
  today.setDate(today.getDate() + days);
  return today.toISOString().split("T")[0];
}
function formatDate(dateField) {
  try {
    return dateField.toDate().toISOString().split("T")[0];
  } catch {
    return "-";
  }
}
function createFlexMessage(data, orderData) {
  const itemTexts = orderData.items?.map(item => {
    return {
      type: "text",
      text: `• ${item.productName} (${item.quantity || 1} ชิ้น)`,
      wrap: true
    };
  }) || [];

  return {
    type: "flex",
    altText: "ลงทะเบียนสำเร็จ ✅",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "✅ ลงทะเบียนสำเร็จ", weight: "bold", size: "lg", color: "#06C755" },
          { type: "separator", margin: "md" },
          { type: "text", text: `📌 ชื่อ: ${data.name}` },
          { type: "text", text: `📞 เบอร์: ${data.phone}` },
          { type: "text", text: `📧 อีเมล: ${data.email}` },
          { type: "text", text: `🗒️ คำสั่งซื้อ: ${data.orderId}` },
          { type: "text", text: `📍 ที่อยู่: ${data.address.line}, ${data.address.subDistrict}, ${data.address.district}, ${data.address.province} ${data.address.postcode}` },
          { type: "text", text: `🗓️ วันที่ลงทะเบียน: ${data.registeredAt}` },
          { type: "text", text: `⏳ หมดประกัน: ${data.warrantyUntil}` },
          { type: "separator", margin: "md" },
          { type: "text", text: `📦 รายการสินค้า:` },
          ...itemTexts,
          { type: "text", text: `🗓️ วันที่สั่งซื้อ: ${formatDate(orderData.purchaseDate)}` }
        ]
      }
    }
  };
}


function createAdminClaimCard(claimId, orderId, reason, status, claimedAt, contact) {
  return {
    type: "flex",
    altText: `รายการเคลม: ${orderId}`,
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "📋 รายการแจ้งเคลม",
            weight: "bold",
            size: "xl",
            color: "#1DB446"
          },
          {
            type: "separator",
            margin: "sm"
          },
          {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            margin: "md",
            contents: [
              { type: "text", text: `🆔 คำสั่งซื้อ: ${orderId}`, size: "sm", wrap: true },
              { type: "text", text: `👤 ผู้แจ้ง: ${contact}`, size: "sm", wrap: true },
              { type: "text", text: `📅 วันที่แจ้ง: ${claimedAt}`, size: "sm" },
              { type: "text", text: `📌 เหตุผล: ${reason}`, size: "sm", wrap: true },
              { type: "text", text: `📦 สถานะ: ${status}`, size: "sm", color: "#FF6F00" }
            ]
          }
        ]
      },
    
    }
  };
}


// ✅ LIFF ID
app.get("/api/liff-id", (req, res) => {
  res.json({ liffId: process.env.LIFF_ID });
});

// ✅ Save LINE user
app.post("/api/user", async (req, res) => {
  try {
    const { userId, displayName, pictureUrl } = req.body;
    if (!userId) return res.status(400).json({ message: "userId is required" });

    await db.collection("users").doc(userId).set({
      userId,
      displayName,
      pictureUrl,
      lastSeen: admin.firestore.Timestamp.now()
    }, { merge: true });

    res.status(200).json({ message: "✅ บันทึกข้อมูลผู้ใช้เรียบร้อย" });
  } catch (error) {
    console.error("❌ Error saving user profile:", error);
    res.status(500).json({ message: "ไม่สามารถบันทึกข้อมูลผู้ใช้ได้" });
  }
});

// ✅ ดึงคำสั่งซื้อ
app.get("/api/order/:orderId", async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const orderDoc = await db.collection("orders").doc(orderId).get();

    if (!orderDoc.exists) {
      return res.status(404).json({ message: "❌ ไม่พบคำสั่งซื้อ" });
    }

    const data = orderDoc.data();
    data.purchaseDateFormatted = formatDate(data.purchaseDate);
    return res.status(200).json(data);
  } catch (error) {
    console.error("❌ Error fetching order:", error);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงคำสั่งซื้อ" });
  }
});

// ✅ ลงทะเบียนสินค้า
app.post("/api/register", async (req, res) => {
  try {
    const { userId, name, phone, email, orderId, address } = req.body;
    const existing = await db.collection("registrations").doc(orderId).get();
    if (existing.exists) {
      return res.status(400).json({ message: "🔁 คำสั่งซื้อนี้ลงทะเบียนแล้ว" });
    }

    const orderDoc = await db.collection("orders").doc(orderId).get();
    if (!orderDoc.exists) {
      return res.status(404).json({ message: "❌ ไม่พบคำสั่งซื้อ" });
    }

    const orderData = orderDoc.data();
    const registeredAt = new Date();
    const warrantyUntil = calculateWarrantyUntil(7);

    await db.collection("registrations").doc(orderId).set({
      userId,
      name,
      phone,
      email,
      orderId,
      address,
      registeredAt: admin.firestore.Timestamp.fromDate(registeredAt),
      warrantyUntil,
    });

    const flexMessage = createFlexMessage({
      userId,
      name,
      phone,
      email,
      orderId,
      address,
      registeredAt: registeredAt.toISOString().split("T")[0],
      warrantyUntil,
    }, orderData);

    await axios.post("https://api.line.me/v2/bot/message/push", {
      to: userId,
      messages: [flexMessage],
    }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
      }
    });

    res.status(200).json({ message: "✅ ลงทะเบียนสำเร็จ" });
  } catch (error) {
    console.error("❌ Error on /api/register:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในระบบ" });
  }
});

// ✅ ตรวจสอบสถานะลงทะเบียนและเคลม
app.get("/api/check-status/:orderId", async (req, res) => {
  try {
    const orderId = req.params.orderId;

    console.log("🔍 เข้ามาเช็คสถานะ orderId:", orderId);

    const regDoc = await db.collection("registrations").doc(orderId).get();

    console.log("📦 ตรวจสอบ registration:", orderId, "=> exists:", regDoc.exists);

    const claimsQuery = await db.collection("claims")
      .where("orderId", "==", orderId)
      .orderBy("claimedAt", "desc")
      .get();

    const registration = regDoc.exists ? regDoc.data() : null;
    const claims = [];
    claimsQuery.forEach(doc => {
      claims.push({ id: doc.id, ...doc.data() });
    });

    if (!registration && claims.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูล" });
    }

    return res.status(200).json({ registration, claims });
  } catch (error) {
    console.error("❌ Error on /api/check-status:", error);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดในระบบ" });
  }
});


// ✅ เคลมสินค้า
app.post("/api/claim", async (req, res) => {
  try {
    const { userId, orderId, reason, contact } = req.body;
    if (!userId || !orderId || !reason || !contact) {
      return res.status(400).json({ message: "กรุณากรอกข้อมูลให้ครบถ้วน" });
    }

    const orderDoc = await db.collection("orders").doc(orderId).get();
    if (!orderDoc.exists) {
      return res.status(404).json({ message: "❌ ไม่พบคำสั่งซื้อ" });
    }

    const regDoc = await db.collection("registrations").doc(orderId).get();
    if (!regDoc.exists) {
      return res.status(400).json({ message: "⛔ ยังไม่ได้ลงทะเบียนสินค้านี้" });
    }

    const regData = regDoc.data();
    const warrantyUntil = new Date(regData.warrantyUntil);
    const today = new Date();

    if (today > warrantyUntil) {
      return res.status(400).json({ message: `⚠️ หมดประกันวันที่ ${regData.warrantyUntil}` });
    }

    await db.collection("claims").add({
      userId,
      orderId,
      reason,
      contact,
      status: "อยู่ระหว่างดำเนินการ",
      claimedAt: admin.firestore.Timestamp.now()
    });

    const newClaimQuery = await db.collection("claims")
      .where("userId", "==", userId)
      .where("orderId", "==", orderId)
      .orderBy("claimedAt", "desc")
      .limit(1)
      .get();

    if (!newClaimQuery.empty) {
      const claimDoc = newClaimQuery.docs[0];
      const claimId = newClaimQuery.docs[0].id;

      const claimData = claimDoc.data();
      const claimedAtDate = claimData.claimedAt.toDate(); // ✅ แปลงเป็น Date
      const claimedAtStr = claimedAtDate.toISOString().split("T")[0]; // ✅ แปลงเป็น string วันที่ เช่น 2025-07-16

      const adminFlex = createAdminClaimCard(claimId, orderId, reason, "อยู่ระหว่างดำเนินการ", claimedAtStr, contact);

// ส่งหาแอดมิน — ไม่ใช้แล้ว
/*
      await axios.post("https://api.line.me/v2/bot/message/push", {
        to: process.env.ADMIN_USER_IDS,
        messages: [adminFlex]
      }, {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
        }
      });*/
    }

    const messages = [
      {
        type: "text",
        text: `📢 ระบบได้รับการแจ้งเคลมของคุณแล้ว\nคำสั่งซื้อ: ${orderId}\nเหตุผล: ${reason}\nทีมงานจะติดต่อกลับภายใน 1-2 วันทำการ`
      },
      {
        type: "flex",
        altText: "กรุณาส่งรูปหลักฐานผ่านแชทนี้",
        contents: {
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            contents: [
              { type: "text", text: "📷 กรุณาส่งรูปหลักฐานการเคลม", weight: "bold", wrap: true },
              { type: "text", text: "เช่น:\n• รูปสินค้ามีปัญหา\n• กล่องสินค้า\n• ใบเสร็จ\nส่งผ่านแชทนี้ได้เลยครับ", size: "sm", wrap: true }
            ]
          }
        }
      }
    ];

    await axios.post("https://api.line.me/v2/bot/message/push", {
      to: userId,
      messages
    }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
      }
    });

    res.status(200).json({ message: "✅ ส่งคำร้องเคลมสำเร็จ" });
  } catch (error) {
    console.error("❌ Error on /api/claim:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการแจ้งเคลม" });
  }
});

app.get("/api/claims", async (req, res) => {
  try {
    const snapshot = await db.collection("claims").orderBy("claimedAt", "desc").get();
    const claims = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        claimedAtFormatted: formatDate(data.claimedAt)
      };
    });
    res.json({ claims });
  } catch (err) {
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลการเคลม" });
  }
});


app.patch("/api/claims/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  console.log("📦 PATCH /api/claims/:id/status", { id, status });

  try {
    const docRef = db.collection("claims").doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({ message: "ไม่พบรายการเคลมนี้" });
    }

    await docRef.update({ status });
    res.json({ message: "✅ อัปเดตสถานะเรียบร้อย" });
  } catch (err) {
    console.error("❌ PATCH status error:", err);
    res.status(500).json({ message: "❌ อัปเดตสถานะไม่สำเร็จ" });
  }
});


app.get("/api/registrations", async (req, res) => {
  try {
    const snapshot = await db.collection("registrations").orderBy("registeredAt", "desc").get();
    const registrations = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        registeredAtFormatted: formatDate(data.registeredAt)
      };
    });
    res.json({ registrations });
  } catch (err) {
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลลงทะเบียน" });
  }
});


app.delete("/api/claims/:id", async (req, res) => {
  try {
    await db.collection("claims").doc(req.params.id).delete();
    res.json({ message: "✅ ลบรายการเคลมสำเร็จ" });
  } catch (err) {
    res.status(500).json({ message: "❌ ลบไม่สำเร็จ" });
  }
});

app.delete("/api/registrations/:orderId", async (req, res) => {
  try {
    await db.collection("registrations").doc(req.params.orderId).delete();
    res.json({ message: "✅ ลบรายการลงทะเบียนสำเร็จ" });
  } catch (err) {
    res.status(500).json({ message: "❌ ลบไม่สำเร็จ" });
  }
});



// ✅ API ส่ง firebaseConfig แบบปลอดภัย (ไม่ใส่ key ลับ)
app.get("/api/firebase-config", (req, res) => {
  res.json({
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID
  });
});

const multer = require("multer");
const XLSX = require("xlsx");
const upload = multer({ storage: multer.memoryStorage() });

function parseExcelDate(value) {
  if (!value) return null;

  if (typeof value === "number") {
    return new Date(Math.round((value - 25569) * 86400 * 1000));
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)) {
    const iso = value.replace(" ", "T") + ":00"; // ➜ ISO format
    return new Date(iso);
  }

  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}



app.post("/api/upload-orders", upload.single("file"), async (req, res) => {
  try {
    const buffer = req.file.buffer;
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    let added = 0;
    let skipped = 0;

    for (const row of data) {
      const orderId = row["หมายเลขคำสั่งซื้อ"];
      if (!orderId) continue;

      const orderRef = db.collection("orders").doc(orderId);
      const existing = await orderRef.get();
      if (existing.exists) {
  const existingData = existing.data();
  const newItem = {
    productName: row["ชื่อสินค้า"] || "",
    quantity: row["จำนวน"] || 1,
    sku: row["เลขอ้างอิง SKU (SKU Reference No.)"] || "",
    price: row["ราคาขาย"] || 0,
  };

  // อัปเดตเข้า array items เดิม โดยใช้ arrayUnion เพื่อไม่ให้ซ้ำ
  await orderRef.update({
    items: admin.firestore.FieldValue.arrayUnion(newItem)
  });

  skipped++; // นับว่าอัปเดต ไม่ได้เพิ่มใหม่
  continue;
}


      await orderRef.set({
  orderId,
  name: row["ชื่อผู้รับ"] || "",
  status: row["สถานะการสั่งซื้อ"] || "",
  purchaseDate: parseExcelDate(row["เวลาการชำระสินค้า"]),
  items: [
    {
      productName: row["ชื่อสินค้า"] || "",
      quantity: row["จำนวน"] || 1,
      sku: row["เลขอ้างอิง SKU (SKU Reference No.)"] || "",
      price: row["ราคาขาย"] || 0,
    }
  ],
  source: "shopee", // ✅ เพิ่มบรรทัดนี้
  createdAt: admin.firestore.FieldValue.serverTimestamp()
});



      added++;
    }

    res.status(200).json({
      message: `✅ อัปโหลดแล้ว ${added} รายการ, ⏩ ข้าม ${skipped} รายการ (ซ้ำ)`
    });
  } catch (error) {
    console.error("❌ Error uploading orders:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปโหลดคำสั่งซื้อ" });
  }
});

// ✅ แจ้งเตือนสถานะเคลมผ่าน Flex Message
app.post("/api/notify-status-change", async (req, res) => {
  try {
    const { claimId, status } = req.body;

    const claimDoc = await db.collection("claims").doc(claimId).get();
    if (!claimDoc.exists) {
      return res.status(404).json({ message: "ไม่พบรายการเคลม" });
    }

    const claimData = claimDoc.data();
    const { userId, orderId, reason, claimedAt, contact } = claimData;

    const claimedAtStr = claimedAt.toDate().toISOString().split("T")[0];

    const flex = createAdminClaimCard(claimId, orderId, reason, status, claimedAtStr, contact);

    await axios.post("https://api.line.me/v2/bot/message/push", {
      to: userId,
      messages: [
        {
          type: "text",
          text: `📢 สถานะการเคลมของคุณถูกอัปเดตเป็น: ${status}`
        },
        flex
      ]
    }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
      }
    });

    res.status(200).json({ message: "📤 แจ้งเตือนสำเร็จ" });
  } catch (err) {
    console.error("❌ Error on /api/notify-status-change:", err);
    res.status(500).json({ message: "❌ ไม่สามารถแจ้งเตือนสถานะได้" });
  }
});

app.get("/api/registrations/:orderId", async (req, res) => {
  const { orderId } = req.params;
  try {
    const doc = await db.collection("registrations").doc(orderId).get();
    if (doc.exists) {
      res.json({ registered: true, data: doc.data() });
    } else {
      res.json({ registered: false });
    }
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ สำหรับหน้า register
app.get("/api/liff-id-register", (req, res) => {
  res.json({ liffId: process.env.LIFF_ID_REGISTER });
});

// ✅ สำหรับหน้า claim
app.get("/api/liff-id-claim", (req, res) => {
  res.json({ liffId: process.env.LIFF_ID_CLAIM });
});

app.post("/api/upload-orders-tiktok", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "ไม่ได้แนบไฟล์" });

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet); // ใช้ header ภาษาอังกฤษแบบ TikTok

    const batch = db.batch();

    rows.forEach((row) => {
      const orderId = row["Order ID"]?.toString().trim();
      const name = row["Recipient"]?.toString().trim() || "-";
      const productName = row["Product Name"]?.toString().trim() || "-";
      const status = row["Order Status"]?.toString().trim() || "-";

      // 🔄 แปลงวันที่จาก TikTok เช่น "2024-03-18 13:27:45"
      let purchaseDate = null;
      if (row["Paid Time"]) {
        const paidRaw = row["Paid Time"].toString().replace(" ", "T");
        const d = new Date(paidRaw);
        if (!isNaN(d)) purchaseDate = admin.firestore.Timestamp.fromDate(d);
      }

      const ref = db.collection("orders").doc(orderId);
      const orderData = {
        orderId,
        name,
        status,
        purchaseDate,
        items: [
          {
            productName,
            quantity: parseInt(row["Quantity"]) || 1,
          },
        ],
        source: "tiktok",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      batch.set(ref, orderData, { merge: true });
    });

    await batch.commit();
    res.json({ message: `อัปโหลดสำเร็จทั้งหมด ${rows.length} รายการ ✅` });
  } catch (err) {
    console.error("⛔ Upload TikTok Error:", err);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปโหลด TikTok" });
  }
});


//fihfrrji
// ✅ Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
