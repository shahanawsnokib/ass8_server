# Goodturn API

Express and MongoDB API for the Goodturn community-service events platform.

## Setup

1. Install dependencies with `npm install`.
2. Create a `.env` file:

   ```env
   PORT=5000
   MONGODB_URI=your-mongodb-connection-string
   CLIENT_URL=http://localhost:3000
   ```

   Set `CLIENT_URL` to the origin configured as `NEXT_PUBLIC_BASE_URL` in the
   client. Keep database credentials private.
3. Start the server with `node index.js`.

## API

- Public: `GET /events`, `GET /events?limit=6`, and `GET /events/:id`.
- Sign-in required: create events, view your own events, update or delete your
  events, join events, view your joined events, and remove your registration.
- Protected routes verify Better Auth JWTs using the public JWKS endpoint.
