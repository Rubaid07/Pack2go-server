require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require("firebase-admin");

const app = express();
const port = process.env.PORT || 3000;

// ====== FIREBASE ADMIN SETUP ======
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8');
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// ====== MIDDLEWARE ======
app.use(cors({
  origin: ['http://localhost:5173', 'https://pack2go07.web.app'],
  credentials: true,
}));
app.use(express.json());

// ====== TOKEN VERIFY MIDDLEWARE ======
const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).send({ message: "Unauthorized Access" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.decodedEmail = decoded.email;
    next();
  } catch (error) {
    console.error("Token verification failed:", error);
    res.status(403).send({ message: "Forbidden Access" });
  }
};

// ====== DATABASE CONNECTION ======
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ynxyt70.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    const db = client.db("pack2goDB");
    const packageCollection = db.collection("tourPackages");
    const bookingCollection = db.collection("bookings");
    const spinHistoryCollection = db.collection("spinHistory");

    // SPIN FEATURE ROUTES

    //  Validate discount
    app.post('/discounts/validate', verifyToken, async (req, res) => {
      try {
        const { discountCode, packageId } = req.body;
        const userEmail = req.decodedEmail;

        const discount = await spinHistoryCollection.findOne({
          discount_code: discountCode,
          user_email: userEmail
        });

        if (!discount) return res.send({ valid: false, message: 'Discount code not found' });
        if (discount.used) return res.send({ valid: false, message: 'Discount code already used' });
        if (new Date(discount.valid_until) < new Date())
          return res.send({ valid: false, message: 'Discount code expired' });

        const pkg = await packageCollection.findOne({ _id: new ObjectId(packageId) });
        if (!pkg) return res.send({ valid: false, message: 'Package not found' });

        res.send({
          valid: true,
          discount: {
            discount_code: discount.discount_code,
            discount: discount.discount,
            valid_until: discount.valid_until
          }
        });
      } catch (error) {
        console.error('Discount validation error:', error);
        res.status(500).send({ message: 'Error validating discount' });
      }
    });

    // Mark discount as used
    app.patch('/discounts/use/:code', verifyToken, async (req, res) => {
      try {
        const { code } = req.params;
        const userEmail = req.decodedEmail;
        const result = await spinHistoryCollection.updateOne(
          { discount_code: code, user_email: userEmail },
          { $set: { used: true, used_at: new Date() } }
        );
        if (result.modifiedCount === 0)
          return res.status(404).send({ message: 'Discount not found' });

        res.send({ success: true, message: 'Discount marked as used' });
      } catch (error) {
        console.error('Discount use error:', error);
        res.status(500).send({ message: 'Error updating discount' });
      }
    });

    //  Spin Eligibility
    app.get('/spin/eligibility', verifyToken, async (req, res) => {
      try {
        const userEmail = req.decodedEmail;
        const lastSpin = await spinHistoryCollection
          .find({ user_email: userEmail })
          .sort({ spin_date: -1 })
          .limit(1)
          .toArray();

        if (!lastSpin.length)
          return res.send({ eligible: true, timeLeft: null, lastSpin: null });

        const lastSpinTime = new Date(lastSpin[0].spin_date);
        const hoursDiff = (new Date() - lastSpinTime) / (1000 * 60 * 60);

        if (hoursDiff >= 48) {
          res.send({ eligible: true, timeLeft: null, lastSpin: lastSpin[0] });
        } else {
          res.send({
            eligible: false,
            timeLeft: `${Math.ceil(48 - hoursDiff)} hours`,
            lastSpin: lastSpin[0],
          });
        }
      } catch (error) {
        console.error('Spin eligibility error:', error);
        res.status(500).send({ message: 'Error checking spin eligibility' });
      }
    });

    //  Spin the Wheel
    app.post('/spin', verifyToken, async (req, res) => {
      try {
        const userEmail = req.decodedEmail;
        const lastSpin = await spinHistoryCollection
          .find({ user_email: userEmail })
          .sort({ spin_date: -1 })
          .limit(1)
          .toArray();

        if (lastSpin.length > 0) {
          const hoursDiff = (new Date() - new Date(lastSpin[0].spin_date)) / (1000 * 60 * 60);
          if (hoursDiff < 48)
            return res.status(400).send({ message: `You can spin again in ${Math.ceil(48 - hoursDiff)} hours` });
        }

        const discountOptions = [
          { discount: 5, probability: 30 },
          { discount: 10, probability: 25 },
          { discount: 15, probability: 20 },
          { discount: 20, probability: 15 },
          { discount: 25, probability: 7 },
          { discount: 50, probability: 3 },
        ];

        const random = Math.random() * 100;
        let cumulative = 0;
        let selected = discountOptions[0];
        for (const opt of discountOptions) {
          cumulative += opt.probability;
          if (random <= cumulative) {
            selected = opt;
            break;
          }
        }

        const discountCode = `SPIN${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
        const validUntil = new Date();
        validUntil.setDate(validUntil.getDate() + 7);

        const spinData = {
          user_email: userEmail,
          discount: selected.discount,
          discount_code: discountCode,
          valid_until: validUntil,
          spin_date: new Date(),
          used: false
        };

        const result = await spinHistoryCollection.insertOne(spinData);

        res.send({
          success: true,
          discount: selected.discount,
          discountCode,
          validUntil,
          spinId: result.insertedId
        });
      } catch (error) {
        console.error('Spin error:', error);
        res.status(500).send({ message: 'Spin failed' });
      }
    });

    //  Get Spin History
    app.get('/spin/history', verifyToken, async (req, res) => {
      try {
        const history = await spinHistoryCollection
          .find({ user_email: req.decodedEmail })
          .sort({ spin_date: -1 })
          .toArray();
        res.send(history);
      } catch (error) {
        console.error('Spin history error:', error);
        res.status(500).send({ message: 'Error fetching spin history' });
      }
    });

    // PAYMENT ROUTES

    app.post('/create-payment-intent', verifyToken, async (req, res) => {
      try {
        const { price, discountCode } = req.body;
        if (!price || price <= 0)
          return res.status(400).send({ message: 'Invalid price' });

        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(price * 100),
          currency: 'bdt',
          automatic_payment_methods: { enabled: true },
          metadata: {
            user_email: req.decodedEmail,
            discount_code: discountCode || 'none'
          }
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
          paymentIntentId: paymentIntent.id
        });
      } catch (error) {
        console.error('Stripe error:', error);
        res.status(500).send({ message: 'Payment creation failed' });
      }
    });

    app.post('/confirm-payment', verifyToken, async (req, res) => {
      try {
        const { paymentIntentId, bookingData } = req.body;
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

        if (paymentIntent.status !== 'succeeded')
          return res.status(400).send({ message: 'Payment not successful' });

        const pkg = await packageCollection.findOne({ _id: new ObjectId(bookingData.tour_id) });
        if (!pkg) return res.status(404).send({ message: 'Package not found' });
        if (pkg.available_seats < bookingData.seat_count)
          return res.status(400).send({ message: `Only ${pkg.available_seats} seats available` });

        const result = await bookingCollection.insertOne({
          ...bookingData,
          payment_status: 'paid',
          payment_intent_id: paymentIntentId,
          payment_date: new Date(),
          transaction_amount: paymentIntent.amount / 100,
          status: 'confirmed'
        });

        await packageCollection.updateOne(
          { _id: new ObjectId(bookingData.tour_id) },
          { $inc: { bookingCount: 1, available_seats: -bookingData.seat_count } }
        );

        res.send({ success: true, bookingId: result.insertedId });
      } catch (error) {
        console.error('Payment confirmation error:', error);
        res.status(500).send({ message: 'Payment confirmation failed' });
      }
    });

    //  PACKAGE ROUTES

    // Add package
    app.post('/packages', verifyToken, async (req, res) => {
      const newPackage = req.body;
      if (req.decodedEmail !== newPackage.guide_email)
        return res.status(403).send({ message: 'Forbidden Access' });

      const result = await packageCollection.insertOne(newPackage);
      res.send(result);
    });

    // All packages
    app.get('/packages', async (req, res) => {
      const packages = await packageCollection.find().toArray();
      res.send(packages);
    });

    // Featured packages
    app.get('/packages/featured', async (req, res) => {
      const featured = await packageCollection.find().sort({ created_at: -1 }).limit(6).toArray();
      res.send(featured);
    });

    //  Seasonal packages
    app.get('/packages/seasonal', async (req, res) => {
      try {
        const seasonalPackages = await packageCollection
          .find({ isSeasonal: true })
          .sort({ created_at: -1 })
          .limit(6)
          .toArray();

        res.send(seasonalPackages);
      } catch (error) {
        console.error('Failed to fetch seasonal packages:', error);
        res.status(500).send({ message: 'Failed to load seasonal packages' });
      }
    });

    // Single package
    app.get('/packages/:id', async (req, res) => {
      const id = req.params.id;
      const result = await packageCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // Update package
    app.put('/packages/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const updated = req.body;
      const existing = await packageCollection.findOne({ _id: new ObjectId(id) });

      if (!existing || existing.guide_email !== req.decodedEmail)
        return res.status(403).send({ message: 'Forbidden Access' });

      const result = await packageCollection.updateOne({ _id: new ObjectId(id) }, { $set: updated });
      res.send(result);
    });

    // Delete package
    app.delete('/packages/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const existing = await packageCollection.findOne({ _id: new ObjectId(id) });

      if (!existing || existing.guide_email !== req.decodedEmail)
        return res.status(403).send({ message: 'Forbidden Access' });

      const result = await packageCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // BOOKINGS ROUTES
    app.post('/bookings', verifyToken, async (req, res) => {
      const booking = req.body;
      if (req.decodedEmail !== booking.buyer_email)
        return res.status(403).send({ message: 'Forbidden Access' });

      const result = await bookingCollection.insertOne(booking);
      await packageCollection.updateOne(
        { _id: new ObjectId(booking.tour_id) },
        { $inc: { bookingCount: 1 } }
      );
      res.send(result);
    });

    app.get('/bookings', verifyToken, async (req, res) => {
      const email = req.query.email;
      if (email !== req.decodedEmail)
        return res.status(403).send({ message: 'Forbidden Access' });

      const result = await bookingCollection.find({ buyer_email: email }).toArray();
      res.send(result);
    });

    app.get('/guide-bookings', verifyToken, async (req, res) => {
      const result = await bookingCollection.find({ guide_email: req.decodedEmail }).toArray();
      res.send(result);
    });

    app.patch('/bookings/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const booking = await bookingCollection.findOne({ _id: new ObjectId(id) });

      if (!booking || booking.guide_email !== req.decodedEmail)
        return res.status(403).send({ message: 'Forbidden Access' });

      const result = await bookingCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: 'completed' } }
      );
      res.send(result);
    });

    // My packages
    app.get('/my-packages', verifyToken, async (req, res) => {
      const email = req.query.email;
      if (email !== req.decodedEmail)
        return res.status(403).send({ message: 'Forbidden Access' });

      const result = await packageCollection.find({ guide_email: email }).toArray();
      res.send(result);
    });

  } finally { }
}

run().catch(console.dir);

// ROOT
app.get('/', (req, res) => {
  res.send('Pack2Go Server Running ');
});

app.listen(port, () => {
  console.log(` Pack2Go server running on port ${port}`);
  console.log(' Stripe integration active');
});
