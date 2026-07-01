# DB Solar API Documentation

Base URL: `http://localhost:3000/api`

## Authentication

All protected routes require a JWT token in the Authorization header:
```
Authorization: Bearer <token>
```

## Endpoints

### Authentication

#### POST `/auth/signup`
Register a new user.

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "password": "password123",
  "address": "123 Main St" // optional
}
```

**Response:**
```json
{
  "message": "User created successfully",
  "token": "jwt_token_here",
  "user": { ... }
}
```

#### POST `/auth/login`
Login with email and password.

**Request Body:**
```json
{
  "email": "john@example.com",
  "password": "password123"
}
```

#### POST `/auth/forgot-password`
Request password reset.

**Request Body:**
```json
{
  "email": "john@example.com"
}
```

#### GET `/auth/me`
Get current authenticated user. (Protected)

---

### Plants

#### GET `/plants`
Get all plants for authenticated user. (Protected)

**Response:**
```json
{
  "plants": [
    {
      "id": "uuid",
      "name": "Plant 1",
      "location": "Location",
      "capacity": 100.5,
      "status": "active",
      "dailyGeneration": 50.2,
      "monthlyGeneration": 1500.5,
      ...
    }
  ]
}
```

#### GET `/plants/:id`
Get single plant details. (Protected)

#### GET `/plants/:id/generation?period=daily|monthly|yearly`
Get generation data for a plant. (Protected)

---

### Installation Progress

#### GET `/progress`
Get installation progress for authenticated user. (Protected)

**Response:**
```json
{
  "progress": {
    "percentage": 75.5,
    "estimatedCompletion": "2024-12-31",
    "steps": [...],
    "history": [...]
  }
}
```

---

### Complaints

#### GET `/complaints`
Get all complaints for authenticated user. (Protected)

#### GET `/complaints/:id`
Get single complaint details. (Protected)

#### POST `/complaints`
Create a new complaint. (Protected)

**Request:** Multipart form data
- `category`: string
- `title`: string
- `description`: string
- `images`: files (optional, max 5)

---

### FAQs

#### GET `/faqs`
Get all FAQs.

#### GET `/faqs/search?q=query`
Search FAQs.

---

### Quotations

#### POST `/quotations`
Submit a quotation request.

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "address": "123 Main St",
  "propertyType": "Residential",
  "expectedLoad": 10.5, // optional
  "notes": "Additional notes" // optional
}
```

---

### Support

#### POST `/support/query`
Submit a support query. (Protected)

**Request Body:**
```json
{
  "subject": "Subject",
  "message": "Message content"
}
```

---

### Users

#### GET `/users/profile`
Get user profile. (Protected)

#### PUT `/users/profile`
Update user profile. (Protected)

**Request Body:**
```json
{
  "name": "New Name", // optional
  "phone": "+1234567890", // optional
  "address": "New Address" // optional
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "message": "Error message",
  "errors": [...] // for validation errors
}
```

**Status Codes:**
- 200: Success
- 201: Created
- 400: Bad Request
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found
- 500: Internal Server Error

