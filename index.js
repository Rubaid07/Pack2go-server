const express = require('express');
const cors = require('cors')
const app = express();
const port = process.env.PORT || 3000;
var admin = require("firebase-admin");
var serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true,
})
)
app.use(express.json())


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
    const db = client.db("pack2goDB");
    const packageCollection = db.collection("tourPackages");
    const bookingCollection = db.collection("bookings");

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
      const bookingToUpdate = await bookingCollection.findOne({ _id: new ObjectId(id) });

      if (!bookingToUpdate || bookingToUpdate.buyer_email !== req.decodedEmail) {
        return res.status(403).send({ message: 'Forbidden Access' });
      }

      const result = await bookingCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "completed" } }
      );
      res.send(result);
    });

    // app.get('/guide-bookings', verifyToken, async (req, res) => {
    //   const guideEmail = req.decodedEmail;
    //   const result = await bookingCollection.find({ guide_email: guideEmail }).toArray();
    //   res.send(result);
    // });

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
})