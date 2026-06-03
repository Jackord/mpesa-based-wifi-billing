const express = require("express");
const { stkPush } = require("../config/mpesa");
const prisma = require("../config/prismaClient");

const router = express.Router();

// Initiate payment - aligns with Frontend apiClient.initiatePayment
router.post("/payments/initiate", async (req, res) => {
  try {
    const { phone, amount, macAddress, package: pkg, speed } = req.body || {};

    if (!phone || !amount || !macAddress) {
      return res.status(400).send(`
        <html>
        <head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
        <body style="font-family:sans-serif; text-align:center; padding:50px 20px; background:#f1f5f9; color:#ef4444;">
          <h2>Error</h2>
          <p>Missing required fields. Please go back and try again.</p>
        </body>
        </html>
      `);
    }

    // Accept +2547XXXXXXXX, 2547XXXXXXXX, 07XXXXXXXX, 01XXXXXXXX, or 2541XXXXXXXX
    let normalizedPhone = phone.trim().replace(/\+/g, '');
    
    if (normalizedPhone.startsWith('0')) {
      normalizedPhone = '254' + normalizedPhone.slice(1);
    }
    
    if (!/^254(7|1)\d{8}$/.test(normalizedPhone)) {
      return res.status(400).send(`
        <html>
        <head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
        <body style="font-family:sans-serif; text-align:center; padding:50px 20px; background:#f1f5f9; color:#ef4444;">
          <h2>Invalid Number</h2>
          <p>Please enter a valid M-Pesa Safaricom phone number.</p>
          <a href="#" onclick="window.history.back(); return false;" style="color:#0f172a; font-weight:bold;">← Go Back</a>
        </body>
        </html>
      `);
    }

    const transactionId = `TXN_${Date.now()}`;

    await prisma.payment.create({
      data: {
        phone: normalizedPhone,
        amount: Number(amount),
        transactionId,
        macAddress,
        status: "pending"
      }
    });

    const mpesaResponse = await stkPush(normalizedPhone, amount, transactionId);

    if (!mpesaResponse) {
      return res.status(500).send(`
        <html>
        <head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
        <body style="font-family:sans-serif; text-align:center; padding:50px 20px; background:#f1f5f9; color:#ef4444;">
          <h2>Connection Error</h2>
          <p>STK Push failed. No response from M-Pesa API. Please try again.</p>
        </body>
        </html>
      `);
    }

    // Persist CheckoutRequestID for callback correlation
    try {
      const checkoutId = mpesaResponse.CheckoutRequestID || null;
      if (checkoutId) {
        await prisma.payment.update({
          where: { transactionId },
          data: { mpesaRef: checkoutId }
        });
      }
    } catch (e) {
      console.error("Failed to persist mpesa_ref:", e);
    }

    // ✅ Clean UI Response instead of raw JSON text
    return res.send(`
        <html>
        <head>
            <title>Processing Payment...</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; text-align: center; padding: 50px 20px; background: #f1f5f9; color: #334155; }
                .card { background: white; padding: 34px 24px; border-radius: 16px; max-width: 400px; margin: 40px auto; box-shadow: 0 10px 25px rgba(0,0,0,0.05); }
                .loader { border: 4px solid #e2e8f0; border-top: 4px solid #26a65b; border-radius: 50%; width: 45px; height: 45px; animation: spin 1s linear infinite; margin: 24px auto; }
                @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                h2 { color: #0f172a; margin-top: 0; font-size: 22px; }
                p { font-size: 15px; line-height: 1.5; color: #475569; }
                .highlight { background: #f0fdf4; color: #166534; padding: 4px 8px; border-radius: 4px; font-weight: bold; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>STK Push Sent!</h2>
                <div class="loader"></div>
                <p>Please check your phone screen for an automatic <span class="highlight">M-Pesa PIN prompt</span> to pay <b>Ksh ${amount}</b>.</p>
                <p style="font-size: 13px; color: #64748b; margin-top: 20px; border-top: 1px solid #e2e8f0; padding-top: 15px;">
                    Once you input your PIN and press OK, your device will be connected to the internet automatically.
                </p>
            </div>
        </body>
        </html>
    `);
    
  } catch (error) {
    console.error("/payments/initiate error:", error);
    return res.status(500).send(`
      <html>
      <head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
      <body style="font-family:sans-serif; text-align:center; padding:50px 20px; background:#f1f5f9; color:#ef4444;">
        <h2>System Error</h2>
        <p>An unexpected error occurred. Please contact the administrator.</p>
      </body>
      </html>
    `);
  }
});

// Check payment status - aligns with Frontend apiClient.checkPaymentStatus
router.get("/payments/status/:transactionId", async (req, res) => {
  try {
    const { transactionId } = req.params;
    const payment = await prisma.payment.findUnique({
      where: { transactionId },
      select: { status: true, mpesaRef: true, expiresAt: true }
    });
    if (!payment) {
      return res.json({ success: true, data: { status: "pending", mpesaRef: null, expiresAt: null } });
    }
    return res.json({ success: true, data: {
      status: payment.status || "pending",
      mpesaRef: payment.mpesaRef,
      expiresAt: payment.expiresAt
    }});
  } catch (error) {
    console.error("/payments/status error:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch payment status" });
  }
});

module.exports = router;
