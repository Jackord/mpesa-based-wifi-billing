const express = require("express");
const crypto = require("crypto"); // Built-in Node.js module for clean random IDs
const { stkPush } = require("../config/mpesa");
const prisma = require("../config/prismaClient");

const router = express.Router();

// Initiate payment - aligns perfectly with Frontend expectations
router.post("/payments/initiate", async (req, res) => {
  try {
    const { phone, amount, macAddress, package: pkg, speed } = req.body || {};

    if (!phone || !amount || !macAddress) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields. Please fill in all details and try again."
      });
    }

    // Accept +2547XXXXXXXX, 2547XXXXXXXX, 07XXXXXXXX, 01XXXXXXXX, or 2541XXXXXXXX
    let normalizedPhone = phone.trim().replace(/\+/g, '');
    
    if (normalizedPhone.startsWith('0')) {
      normalizedPhone = '254' + normalizedPhone.slice(1);
    }
    
    if (!/^254(7|1)\d{8}$/.test(normalizedPhone)) {
      return res.status(400).json({
        success: false,
        error: "Please enter a valid M-Pesa Safaricom phone number."
      });
    }

    // Generate a short, highly unique ID that will never violate primary key constraints
    const uniqueSuffix = crypto.randomBytes(4).toString("hex").toUpperCase(); // e.g., "A1B2C3D4"
    const transactionId = `TXN_${Date.now()}_${uniqueSuffix}`;

    // Create entry in database securely matching the schema definitions
    await prisma.payment.create({
      data: {
        transactionId: transactionId,
        phone: normalizedPhone,
        amount: Number(amount),
        macAddress: macAddress,
        status: "pending",
        package: pkg || null,     // ✅ Safely passes package selection to DB matching Prisma schema field name
        speed: speed || null      // ✅ Optional network speed tracker
      }
    });

    // Fire the M-Pesa API push
    const mpesaResponse = await stkPush(normalizedPhone, amount, transactionId);

    // If Safaricom gateway failed to answer completely
    if (!mpesaResponse) {
      return res.status(500).json({
        success: false,
        error: "STK Push failed. No response from M-Pesa API gateway. Please try again."
      });
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

    // Return clean JSON data to the frontend
    return res.status(200).json({
      success: true,
      message: "STK Push sent successfully!",
      transactionId: transactionId,
      checkoutRequestId: mpesaResponse.CheckoutRequestID
    });
    
  } catch (error) {
    console.error("/payments/initiate error:", error);
    return res.status(500).json({
      success: false,
      error: "An unexpected system error occurred. Please try again."
    });
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
