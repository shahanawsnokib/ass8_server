import "dotenv/config";
import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import { createRemoteJWKSet, jwtVerify } from "jose";

const app = express();
const port = Number(process.env.PORT ?? 5000);
const authUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const audience = "community-events-api";
const jwks = createRemoteJWKSet(new URL("/api/auth/jwks", authUrl));

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();

const db = client.db("event-management");
const events = db.collection("events");
const joinedEvents = db.collection("joined");

app.use(
  cors({
    origin: process.env.CLIENT_URL ?? "http://localhost:3000",
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.json({ limit: "100kb" }));

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsedDate = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === value;
}

function isFutureDate(value) {
  return isValidDate(value) && value > getToday();
}

function getEventData(body, { allowPastDate = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const event = {
    title: typeof body.title === "string" ? body.title.trim() : "",
    description:
      typeof body.description === "string" ? body.description.trim() : "",
    eventType: typeof body.eventType === "string" ? body.eventType : "",
    eventDate: typeof body.eventDate === "string" ? body.eventDate : "",
    thumbnailUrl:
      typeof body.thumbnailUrl === "string" ? body.thumbnailUrl.trim() : "",
    location: typeof body.location === "string" ? body.location.trim() : "",
  };
  const validTypes = ["Cleanup", "Tree planting", "Donation"];

  if (
    !event.title ||
    !event.description ||
    !validTypes.includes(event.eventType) ||
    !(allowPastDate ? isValidDate(event.eventDate) : isFutureDate(event.eventDate)) ||
    !event.location
  ) {
    return null;
  }

  try {
    const url = new URL(event.thumbnailUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }
  } catch {
    return null;
  }

  return event;
}

function getObjectId(value) {
  return typeof value === "string" && ObjectId.isValid(value)
    ? new ObjectId(value)
    : null;
}

function ownerFilter(user) {
  return {
    $or: [
      { organizerId: user.id },
      { organizerEmail: user.email },
    ],
  };
}

async function authenticate(req, res, next) {
  const authorization = req.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";

  if (!token) {
    return res.status(401).json({ error: "Sign in to continue." });
  }

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: authUrl,
      audience,
      algorithms: ["EdDSA"],
    });

    if (typeof payload.sub !== "string" || typeof payload.email !== "string") {
      return res.status(401).json({ error: "Invalid authentication token." });
    }

    req.user = { id: payload.sub, email: payload.email };
    return next();
  } catch (error) {
    console.error("Could not verify API token:", error);
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

app.get("/", (_req, res) => {
  res.send("Goodturn community events API");
});

app.get("/events", async (req, res) => {
  const query = { eventDate: { $gt: getToday() } };
  let cursor = events.find(query).sort({ eventDate: 1 });
  const requestedLimit = Number(req.query.limit);

  if (Number.isInteger(requestedLimit) && requestedLimit > 0) {
    cursor = cursor.limit(Math.min(requestedLimit, 100));
  }

  return res.json(await cursor.toArray());
});

app.get("/events/mine", authenticate, async (req, res) => {
  const records = await events
    .find(ownerFilter(req.user))
    .sort({ eventDate: 1 })
    .toArray();

  return res.json(records);
});

app.get("/events/:id", async (req, res) => {
  const id = getObjectId(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Invalid event ID." });
  }

  const event = await events.findOne({ _id: id });
  if (!event) {
    return res.status(404).json({ error: "Event not found." });
  }

  return res.json(event);
});

app.post("/create-event", authenticate, async (req, res) => {
  const event = getEventData(req.body);
  if (!event) {
    return res.status(400).json({ error: "Enter valid event details and a future date." });
  }

  const record = {
    ...event,
    organizerId: req.user.id,
    organizerEmail: req.user.email,
  };
  const result = await events.insertOne(record);

  return res.status(201).json({ ...record, _id: result.insertedId });
});

app.patch("/events/:id", authenticate, async (req, res) => {
  const id = getObjectId(req.params.id);

  if (!id) {
    return res.status(400).json({ error: "Invalid event ID." });
  }

  const existingEvent = await events.findOne(
    { _id: id, ...ownerFilter(req.user) },
    { projection: { eventDate: 1 } },
  );
  if (!existingEvent) {
    return res.status(404).json({ error: "Event not found." });
  }

  const event = getEventData(req.body, { allowPastDate: true });
  if (!event) {
    return res.status(400).json({ error: "Enter valid event details." });
  }
  if (event.eventDate !== existingEvent.eventDate && !isFutureDate(event.eventDate)) {
    return res.status(400).json({ error: "Event dates must be in the future." });
  }

  const result = await events.updateOne(
    { _id: id, ...ownerFilter(req.user) },
    { $set: event },
  );

  if (!result.matchedCount) {
    return res.status(404).json({ error: "Event not found." });
  }

  return res.json({ message: "Event updated." });
});

app.delete("/events/:id", authenticate, async (req, res) => {
  const id = getObjectId(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Invalid event ID." });
  }

  const result = await events.deleteOne({
    _id: id,
    ...ownerFilter(req.user),
  });

  if (!result.deletedCount) {
    return res.status(404).json({ error: "Event not found." });
  }

  return res.json({ message: "Event deleted." });
});

app.get("/joined", authenticate, async (req, res) => {
  const records = await joinedEvents
    .find({
      $or: [
        { userId: req.user.id },
        { email: req.user.email },
        { userEmail: req.user.email },
      ],
    })
    .sort({ eventDate: 1 })
    .toArray();

  return res.json(records);
});

app.get("/joined/:email", authenticate, async (req, res) => {
  if (req.params.email.toLowerCase() !== req.user.email.toLowerCase()) {
    return res.status(403).json({ error: "You can only view your own plan." });
  }

  const records = await joinedEvents
    .find({
      $or: [
        { userId: req.user.id },
        { email: req.user.email },
        { userEmail: req.user.email },
      ],
    })
    .sort({ eventDate: 1 })
    .toArray();

  return res.json(records);
});

app.post("/joined", authenticate, async (req, res) => {
  const eventId = getObjectId(req.body.eventId ?? req.body.id);
  if (!eventId) {
    return res.status(400).json({ error: "Invalid event ID." });
  }

  const event = await events.findOne({
    _id: eventId,
    eventDate: { $gt: getToday() },
  });
  if (!event) {
    return res.status(404).json({ error: "Upcoming event not found." });
  }

  const duplicate = await joinedEvents.findOne({
    $and: [
      {
        $or: [
          { userId: req.user.id },
          { email: req.user.email },
          { userEmail: req.user.email },
        ],
      },
      {
        $or: [
          { eventId: eventId.toString() },
          { id: eventId.toString() },
        ],
      },
    ],
  });
  if (duplicate) {
    return res.status(409).json({ error: "You have already joined this event." });
  }

  const record = {
    eventId: eventId.toString(),
    id: eventId.toString(),
    title: event.title,
    description: event.description,
    eventType: event.eventType,
    eventDate: event.eventDate,
    thumbnailUrl: event.thumbnailUrl,
    location: event.location,
    organizerEmail: event.organizerEmail,
    userId: req.user.id,
    email: req.user.email,
  };
  const result = await joinedEvents.insertOne(record);

  return res.status(201).json({ ...record, _id: result.insertedId });
});

app.delete("/joined/:id", authenticate, async (req, res) => {
  const id = getObjectId(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Invalid registration ID." });
  }

  const result = await joinedEvents.deleteOne({
    _id: id,
    $or: [
      { userId: req.user.id },
      { email: req.user.email },
      { userEmail: req.user.email },
    ],
  });
  if (!result.deletedCount) {
    return res.status(404).json({ error: "Joined event not found." });
  }

  return res.json({ message: "Event removed from your plan." });
});

app.use((error, _req, res, _next) => {
  console.error("API request failed:", error);
  return res.status(500).json({ error: "The server could not complete the request." });
});

app.listen(port, () => {
  console.log(`Goodturn API is running on port ${port}.`);
});
