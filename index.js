require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 3000;
const admin = require("firebase-admin");

const app = express();

// Middlewire
app.use(cors());
app.use(express.json());

//Custom Middlewire
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ success: false, message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).send({ success: false, message: "Forbidden" });
  }
};

let serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const uri = `mongodb+srv://${process.env.MONGO_USER}:${process.env.MONGO_PASS}@crudcluster.buy7rkc.mongodb.net/${process.env.MONGO_DB}?retryWrites=true&w=majority&appName=crudCluster`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const assignmentCollections = client
      .db(process.env.MONGO_DB)
      .collection("assignments");
    const reviewsCollections = client
      .db(process.env.MONGO_DB)
      .collection("reviews");

    app.get("/", async (req, res) => {
      res.send("Server is running");
    });

    // POST /reviews - Add a review
    app.post("/reviews", async (req, res) => {
      try {
        const { name, image, email, text } = req.body;
      if (!name || !email || !text)
        return res.status(400).json({ error: "Missing fields" });
      const result = await reviewsCollections.insertOne({
        name,
        image,
        email,
        text,
        createdAt: new Date(),
      });
      res.status(201).json({
        success: true,
        message: "Review added successfully",
        insertedId: result.insertedId,
      });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
      
    });

    // GET /reviews?limit=6 - Get recent reviews (for homepage)
    app.get("/reviews", async (req, res) => {
      const limit = parseInt(req.query.limit) || 12;
      const page = parseInt(req.query.page) || 1;
      const skip = (page - 1) * limit;
      const reviews = await reviewsCollections
        .find({})
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();
      res.json(reviews);
    });

    app.post("/assignments", verifyToken, async (req, res) => {
      const assignment = req.body;
      try {
        const result = await assignmentCollections.insertOne(assignment);
        res.send({
          success: true,
          message: "Assignment created successfully",
          insertedId: result.insertedId,
        });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    app.get("/assignments", async (req, res) => {
      const { difficulty, search } = req.query;

      const filter = {};

      if (difficulty) {
        filter.difficulty = difficulty;
      }

      if (search) {
        filter.title = { $regex: search, $options: "i" };
      }

      try {
        const result = await assignmentCollections.find(filter).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    app.get("/assignment/:id", async (req, res) => {
      const id = req.params.id;
      try {
        const assignment = await assignmentCollections.findOne({
          _id: new ObjectId(id),
        });

        if (!assignment) {
          return res
            .status(404)
            .send({ success: false, message: "Assignment not found" });
        }
        res.send(assignment);
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    // In your Express router
    app.get("/leaderboard", async (req, res) => {
      const page = parseInt(req.query.page) || 1;
      const limit = 10;
      const skip = (page - 1) * limit;

      const pipeline = [
        {
          $group: {
            _id: "$creator.email",
            name: { $first: "$creator.name" },
            assignmentCount: { $sum: 1 },
          },
        },
        { $sort: { assignmentCount: -1 } },
        { $skip: skip },
        { $limit: limit },
      ];

      const leaderboard = await assignmentCollections
        .aggregate(pipeline)
        .toArray();
      res.json(leaderboard);
    });

    app.put("/assignments/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;

      try {
        const result = await assignmentCollections.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              title: updatedData.title,
              description: updatedData.description,
              marks: updatedData.marks,
              thumbnail: updatedData.thumbnail,
              difficulty: updatedData.difficulty,
              dueDate: updatedData.dueDate,
            },
          }
        );

        if (result.modifiedCount > 0) {
          res.send({
            success: true,
            message: "Assignment updated successfully",
          });
        } else {
          res
            .status(400)
            .send({ success: false, message: "Nothing was updated" });
        }
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    app.delete("/assignments/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const email = req.query.email;

      try {
        const assignment = await assignmentCollections.findOne({
          _id: new ObjectId(id),
        });

        if (!assignment) {
          return res
            .status(404)
            .send({ success: false, message: "Assignment not found" });
        }

        if (assignment.creator?.email !== email) {
          return res.status(403).send({
            success: false,
            message: "You are not authorized to delete this assignment.",
          });
        }

        const result = await assignmentCollections.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount > 0) {
          res.send({ success: true });
        } else {
          res
            .status(500)
            .send({ success: false, message: "Delete failed internally." });
        }
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    app.get("/submitted-assignments", verifyToken, async (req, res) => {
      const email = req.query.email;
      if (!email) return res.status(400).send({ message: "Email is required" });

      try {
        const submissions = await client
          .db(process.env.MONGO_DB)
          .collection("submittedAssignments")
          .find({ userEmail: email })
          .toArray();

        res.send(submissions);
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    app.post("/submitted-assignments", verifyToken, async (req, res) => {
      const data = req.body;
      try {
        const result = await client
          .db(process.env.MONGO_DB)
          .collection("submittedAssignments")
          .insertOne({ ...data, status: "pending", submittedAt: new Date() });

        res.send({ success: true, insertedId: result.insertedId });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    app.patch("/submitted-assignments/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const { obtainedMarks, feedback } = req.body;

      try {
        const result = await client
          .db(process.env.MONGO_DB)
          .collection("submittedAssignments")
          .updateOne(
            { _id: new ObjectId(id) },
            {
              $set: {
                obtainedMarks,
                feedback,
                status: "completed",
                markedAt: new Date(),
              },
            }
          );

        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    app.get("/pending-submitted-assignments", verifyToken, async (req, res) => {
      const email = req.query.email;
      if (!email) {
        return res
          .status(400)
          .send({ success: false, message: "Email is required" });
      }

      try {
        const submissions = await client
          .db(process.env.MONGO_DB)
          .collection("submittedAssignments")
          .find({ status: "pending", userEmail: { $ne: email } }) // exclude self
          .toArray();

        res.send(submissions);
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });
  } finally {
    app.listen(port, () => {
      console.log(`App listening on port ${port}`);
    });
  }
}
run().catch(console.dir);
