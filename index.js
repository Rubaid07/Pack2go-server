require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;


const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

var admin = require("firebase-admin");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
var serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

// CORS setup
app.use(cors({
  origin: ['http://localhost:5173', 'https://pack2go07.web.app'],
  credentials: true,
}));
app.use(express.json());

const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).send({ message: "Unauthorized Access" });
  }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.decodedEmail = decoded.email;
    next();
  } catch (error) {
    console.error("verification fail:", error);
    return res.status(403).send({ message: "Forbidden Access" });
  }
};

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
    await client.connect();
    const db = client.db("pack2goDB");
    const packageCollection = db.collection("tourPackages");
    const bookingCollection = db.collection("bookings");
    const spinHistoryCollection = db.collection("spinHistory");

    //spin
// Check spin eligibility
app.post('/discounts/validate', verifyToken, async (req, res) => {
    try {
        const { discountCode, packageId } = req.body;
        const userEmail = req.decodedEmail;

        // Find the discount
        const discount = await spinHistoryCollection.findOne({
            discount_code: discountCode,
            user_email: userEmail
        });

        if (!discount) {
            return res.send({
                valid: false,
                message: 'Discount code not found'
            });
        }

        // Check if already used
        if (discount.used) {
            return res.send({
                valid: false,
                message: 'Discount code already used'
            });
        }

        // Check validity
        if (new Date(discount.valid_until) < new Date()) {
            return res.send({
                valid: false,
                message: 'Discount code has expired'
            });
        }

        // Check if package exists
        const package = await packageCollection.findOne({ 
            _id: new ObjectId(packageId) 
        });

        if (!package) {
            return res.send({
                valid: false,
                message: 'Package not found'
            });
        }

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
            {
                discount_code: code,
                user_email: userEmail
            },
            {
                $set: {
                    used: true,
                    used_at: new Date()
                }
            }
        );

        if (result.modifiedCount === 0) {
            return res.status(404).send({ message: 'Discount not found' });
        }

        res.send({ success: true, message: 'Discount marked as used' });

    } catch (error) {
        console.error('Discount use error:', error);
        res.status(500).send({ message: 'Error updating discount' });
    }
});



    app.get('/spin/eligibility', verifyToken, async (req, res) => {
    try {
        const userEmail = req.decodedEmail;
        
        // Find user's last spin
        const lastSpin = await spinHistoryCollection
            .find({ user_email: userEmail })
            .sort({ spin_date: -1 })
            .limit(1)
            .toArray();

        if (lastSpin.length === 0) {
            return res.send({ 
                eligible: true,
                timeLeft: null,
                lastSpin: null
            });
        }

        const lastSpinTime = new Date(lastSpin[0].spin_date);
        const now = new Date();
        const timeDiff = now - lastSpinTime;
        const hoursDiff = timeDiff / (1000 * 60 * 60);
        
        // 2 days = 48 hours
        if (hoursDiff >= 48) {
            return res.send({ 
                eligible: true,
                timeLeft: null,
                lastSpin: lastSpin[0]
            });
        } else {
            const hoursLeft = 48 - hoursDiff;
            return res.send({ 
                eligible: false,
                timeLeft: `${Math.ceil(hoursLeft)} hours`,
                lastSpin: lastSpin[0]
            });
        }
    } catch (error) {
        console.error('Spin eligibility error:', error);
        res.status(500).send({ message: 'Error checking spin eligibility' });
    }
});

// Spin the wheel
app.post('/spin', verifyToken, async (req, res) => {
    try {
        const userEmail = req.decodedEmail;
        
        // Check eligibility again (security)
        const lastSpin = await spinHistoryCollection
            .find({ user_email: userEmail })
            .sort({ spin_date: -1 })
            .limit(1)
            .toArray();

        if (lastSpin.length > 0) {
            const lastSpinTime = new Date(lastSpin[0].spin_date);
            const now = new Date();
            const timeDiff = now - lastSpinTime;
            const hoursDiff = timeDiff / (1000 * 60 * 60);
            
            if (hoursDiff < 48) {
                return res.status(400).send({ 
                    message: `You can spin again in ${Math.ceil(48 - hoursDiff)} hours` 
                });
            }
        }

        // Discount options with probabilities
        const discountOptions = [
            { discount: 5, probability: 30 },
            { discount: 10, probability: 25 },
            { discount: 15, probability: 20 },
            { discount: 20, probability: 15 },
            { discount: 25, probability: 7 },
            { discount: 50, probability: 3 },
        ];

        // Calculate random discount
        const random = Math.random() * 100;
        let cumulativeProbability = 0;
        let selectedDiscount = discountOptions[0];

        for (const option of discountOptions) {
            cumulativeProbability += option.probability;
            if (random <= cumulativeProbability) {
                selectedDiscount = option;
                break;
            }
        }

        // Generate unique discount code
        const discountCode = `SPIN${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
        
        // Calculate validity (7 days from now)
        const validUntil = new Date();
        validUntil.setDate(validUntil.getDate() + 7);

        // Save spin history
        const spinData = {
            user_email: userEmail,
            discount: selectedDiscount.discount,
            discount_code: discountCode,
            valid_until: validUntil,
            spin_date: new Date(),
            used: false
        };

        const result = await spinHistoryCollection.insertOne(spinData);

        res.send({
            success: true,
            discount: selectedDiscount.discount,
            discountCode: discountCode,
            validUntil: validUntil,
            spinId: result.insertedId
        });

    } catch (error) {
        console.error('Spin error:', error);
        res.status(500).send({ message: 'Spin failed' });
    }
});

// Get user's spin history
app.get('/spin/history', verifyToken, async (req, res) => {
    try {
        const userEmail = req.decodedEmail;
        
        const spinHistory = await spinHistoryCollection
            .find({ user_email: userEmail })
            .sort({ spin_date: -1 })
            .toArray();

        res.send(spinHistory);
    } catch (error) {
        console.error('Spin history error:', error);
        res.status(500).send({ message: 'Error fetching spin history' });
    }
});
    // spin end

     app.post('/create-payment-intent', verifyToken, async (req, res) => {
    try {
        console.log(' Creating payment intent...');
        const { price, discountCode } = req.body;
        
        if (!price || price <= 0) {
            return res.status(400).send({ message: 'Invalid price amount' });
        }
        
        const amount = Math.round(price * 100);
        
        console.log(' Amount:', amount, 'BDT');
        if (discountCode) {
            console.log(' Discount applied:', discountCode);
        }

        const paymentIntent = await stripe.paymentIntents.create({
            amount: amount,
            currency: 'bdt',
            automatic_payment_methods: {
                enabled: true,
            },
            metadata: {
                user_email: req.decodedEmail,
                service: 'tour-booking',
                discount_code: discountCode || 'none'
            }
        });

        console.log(' Payment intent created:', paymentIntent.id);

        res.send({
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id
        });
        
    } catch (error) {
        console.error('❌ Stripe payment intent error:', error);
        res.status(500).send({ 
            message: 'Payment processing failed',
            error: error.message 
        });
    }
});

    // PAYMENT CONFIRMATION
   app.post('/confirm-payment', verifyToken, async (req, res) => {
    try {
        const { paymentIntentId, bookingData } = req.body;
        
        console.log(' Confirming payment:', paymentIntentId);

        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        
        if (paymentIntent.status !== 'succeeded') {
            return res.status(400).send({ 
                message: 'Payment not successful',
                status: paymentIntent.status 
            });
        }

        const package = await packageCollection.findOne({ 
            _id: new ObjectId(bookingData.tour_id) 
        });

        if (!package) {
            return res.status(404).send({ message: 'Package not found' });
        }

        if (package.available_seats < bookingData.seat_count) {
            return res.status(400).send({ 
                message: `Only ${package.available_seats} seats available` 
            });
        }

        const completeBookingData = {
            ...bookingData,
            payment_status: 'paid',
            payment_intent_id: paymentIntentId,
            payment_date: new Date(),
            transaction_amount: paymentIntent.amount / 100,
            status: 'confirmed'
        };

        const result = await bookingCollection.insertOne(completeBookingData);

        await packageCollection.updateOne(
            { _id: new ObjectId(bookingData.tour_id) },
            { 
                $inc: { 
                    bookingCount: 1,
                    available_seats: -bookingData.seat_count 
                } 
            }
        );

        console.log('Booking confirmed with ID:', result.insertedId);
        console.log(`Available seats updated: ${package.available_seats} → ${package.available_seats - bookingData.seat_count}`);

        res.send({
            success: true,
            bookingId: result.insertedId,
            paymentStatus: 'succeeded'
        });
        
    } catch (error) {
        console.error(' Payment confirmation error:', error);
        res.status(500).send({ 
            message: 'Payment confirmation failed',
            error: error.message 
        });
    }
});

    app.post('/packages', verifyToken, async (req, res) => {
      const newPackage = req.body;
      if (req.decodedEmail !== newPackage.guide_email) {
        return res.status(403).send({ message: 'Forbidden Access' });
      }
      const result = await packageCollection.insertOne(newPackage);
      res.send(result);
    });

    app.get('/packages', async (req, res) => {
      const packages = await packageCollection.find().toArray();
      res.send(packages);
    });

    app.get('/packages/featured', async (req, res) => {
      const featured = await packageCollection.find().sort({ created_at: -1 }).limit(6).toArray();
      res.send(featured);
    });

    app.get('/packages/:id', async (req, res) => {
      const id = req.params.id;
      const result = await packageCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.post('/bookings', verifyToken, async (req, res) => {
      const booking = req.body;
      if (req.decodedEmail !== booking.buyer_email) {
        return res.status(403).send({ message: 'Forbidden Access' });
      }
      const result = await bookingCollection.insertOne(booking);

      await packageCollection.updateOne(
        { _id: new ObjectId(booking.tour_id) },
        { $inc: { bookingCount: 1 } }
      );
      res.send(result);
    });

    app.get('/bookings', verifyToken, async (req, res) => {
      const email = req.query.email;
      const tokenEmail = req.decodedEmail;
      if (email !== tokenEmail) {
        return res.status(403).send({ message: 'Forbidden Access' });
      }
      const bookings = await bookingCollection.find({ buyer_email: email }).toArray();
      res.send(bookings);
    });

    app.patch('/bookings/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const booking = await bookingCollection.findOne({ _id: new ObjectId(id) });
      if (!booking || booking.guide_email !== req.decodedEmail) {
        return res.status(403).send({ message: 'Forbidden Access' });
      }
      const result = await bookingCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: 'completed' } }
      );
      res.send(result);
    });

    app.get('/guide-bookings', verifyToken, async (req, res) => {
      const guideEmail = req.decodedEmail;
      const result = await bookingCollection.find({ guide_email: guideEmail }).toArray();
      res.send(result);
    });


    app.get('/my-packages', verifyToken, async (req, res) => {
      const email = req.query.email;
      const tokenEmail = req.decodedEmail;
      if (email !== tokenEmail) {
        return res.status(403).send({ message: 'Forbidden Access' });
      }
      const myPackages = await packageCollection.find({ guide_email: email }).toArray();
      res.send(myPackages);
    });

    app.put('/packages/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const updated = req.body;
      const existingPackage = await packageCollection.findOne({ _id: new ObjectId(id) });
      if (!existingPackage || existingPackage.guide_email !== req.decodedEmail) {
        return res.status(403).send({ message: 'Forbidden Access' });
      }
      const result = await packageCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updated }
      );
      res.send(result);
    });

    app.delete('/packages/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const existingPackage = await packageCollection.findOne({ _id: new ObjectId(id) });
      if (!existingPackage || existingPackage.guide_email !== req.decodedEmail) {
        return res.status(403).send({ message: 'Forbidden Access' });
      }
      const result = await packageCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

  } finally {

  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('Pack2Go is cooking')
})
app.listen(port, () => {
  console.log(`Pack2Go server is running on port ${port}`);
  console.log('Stripe integration is enabled');
})