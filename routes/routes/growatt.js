const express = require('express');
const { authenticate } = require('../middleware/auth');
const pool = require('../database/db');
const { body, validationResult } = require('express-validator');
const axios = require('axios');

const router = express.Router();

// Growatt API proxy endpoints (to avoid CORS issues on web)
const GROWATT_BASE_URL = 'https://server.growatt.com';

// Proxy: Login to Growatt API
router.post('/proxy/login', authenticate, async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    const response = await axios.post(
      `${GROWATT_BASE_URL}/index`,
      new URLSearchParams({
        action: 'login',
        userName: username,
        password: password,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        maxRedirects: 0,
        validateStatus: (status) => status < 400,
      }
    );

    // Extract cookies for debugging
    const cookies = response.headers['set-cookie'] || [];
    console.log('🔵 Login response cookies:', cookies.length, 'cookies received');

    res.json(response.data);
  } catch (error) {
    console.error('Growatt proxy login error:', error.message);
    if (error.response) {
      console.error('Login error response:', error.response.status, error.response.data);
    }
    res.status(error.response?.status || 500).json({
      message: error.message,
      data: error.response?.data,
    });
  }
});

// Proxy: Get plant list
router.post('/proxy/plants', authenticate, async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    // First login to get session
    const loginResponse = await axios.post(
      `${GROWATT_BASE_URL}/index`,
      new URLSearchParams({
        action: 'login',
        userName: username,
        password: password,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        maxRedirects: 0,
        validateStatus: (status) => status < 400,
      }
    );

    // Extract cookies from login response
    const cookies = loginResponse.headers['set-cookie'] || [];
    
    // Extract JSESSIONID and assToken from cookies
    let jsessionId = '';
    let assToken = '';
    let allCookies = [];
    
    cookies.forEach(cookie => {
      const cookieStr = cookie.split(';')[0]; // Get cookie name=value part
      allCookies.push(cookieStr);
      
      if (cookieStr.includes('JSESSIONID=')) {
        jsessionId = cookieStr.split('JSESSIONID=')[1];
      }
      if (cookieStr.includes('assToken=')) {
        assToken = cookieStr.split('assToken=')[1];
      }
    });

    // Build cookie string with all cookies
    const cookieString = allCookies.join('; ');

    console.log('🔵 Proxy: Login successful, JSESSIONID:', jsessionId.substring(0, 10) + '...');
    console.log('🔵 Proxy: assToken:', assToken.substring(0, 10) + '...');
    console.log('🔵 Proxy: Using cookies for plant list');

    // Then get plant list using the same cookie string
    const plantsResponse = await axios.post(
      `${GROWATT_BASE_URL}/index`,
      new URLSearchParams({
        action: 'getPlantList',
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          'Origin': 'https://server.growatt.com',
          'Referer': 'https://server.growatt.com/index',
          'Cookie': cookieString,
        },
        maxRedirects: 0,
        validateStatus: (status) => status < 400,
      }
    );

    console.log('✅ Proxy: Got plants response status:', plantsResponse.status);
    console.log('✅ Proxy: Response type:', typeof plantsResponse.data);
    
    // Check if response is HTML (login page)
    if (typeof plantsResponse.data === 'string' && plantsResponse.data.includes('<!DOCTYPE')) {
      console.error('❌ Proxy: Got HTML response instead of JSON - session not maintained');
      return res.status(401).json({
        message: 'Session expired - please login again',
        error: 'Got HTML login page instead of plant list',
      });
    }

    res.json(plantsResponse.data);
  } catch (error) {
    console.error('Growatt proxy plants error:', error.message);
    if (error.response) {
      console.error('Error response data:', error.response.data);
    }
    res.status(error.response?.status || 500).json({
      message: error.message,
      data: error.response?.data,
    });
  }
});

// Proxy: Get plant info
router.post('/proxy/plant/:plantId', authenticate, async (req, res) => {
  try {
    const { plantId } = req.params;
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    // First login to get session
    const loginResponse = await axios.post(
      `${GROWATT_BASE_URL}/index`,
      {
        action: 'login',
        userName: username,
        password: password,
      },
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
      }
    );

    // Extract cookies from login response
    const cookies = loginResponse.headers['set-cookie'] || [];
    const cookieString = cookies.join('; ');

    // Then get plant info
    const plantResponse = await axios.post(
      `${GROWATT_BASE_URL}/index`,
      {
        action: 'getPlant',
        plantId: plantId,
      },
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'Cookie': cookieString,
        },
      }
    );

    res.json(plantResponse.data);
  } catch (error) {
    console.error('Growatt proxy plant info error:', error.message);
    res.status(error.response?.status || 500).json({
      message: error.message,
      data: error.response?.data,
    });
  }
});

// Proxy: Get devices by plant list (for real-time generation data)
router.post('/proxy/devices/:plantId', authenticate, async (req, res) => {
  try {
    const { plantId } = req.params;
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    console.log('🔵 Proxy: Getting devices for plant:', plantId);

    // First login to get session and cookies
    const loginResponse = await axios.post(
      `${GROWATT_BASE_URL}/index`,
      new URLSearchParams({
        action: 'login',
        userName: username,
        password: password,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        maxRedirects: 0,
        validateStatus: (status) => status < 400,
      }
    );

    // Extract cookies from login response
    const cookies = loginResponse.headers['set-cookie'] || [];
    
    // Extract JSESSIONID and assToken from cookies
    let jsessionId = '';
    let assToken = '';
    let allCookies = [];
    
    cookies.forEach(cookie => {
      const cookieStr = cookie.split(';')[0]; // Get cookie name=value part
      allCookies.push(cookieStr);
      
      if (cookieStr.includes('JSESSIONID=')) {
        jsessionId = cookieStr.split('JSESSIONID=')[1];
      }
      if (cookieStr.includes('assToken=')) {
        assToken = cookieStr.split('assToken=')[1];
      }
    });

    // Build cookie string with all cookies
    const cookieString = allCookies.join('; ');

    console.log('🔵 Proxy: Using cookies:', cookieString.substring(0, 80) + '...');

    // Use the correct endpoint: /panel/getDevicesByPlantList
    const devicesResponse = await axios.post(
      `${GROWATT_BASE_URL}/panel/getDevicesByPlantList`,
      new URLSearchParams({
        currPage: 1,
        plantId: plantId,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          'Origin': 'https://server.growatt.com',
          'Referer': 'https://server.growatt.com/index',
          'Cookie': cookieString,
        },
        maxRedirects: 0,
        validateStatus: (status) => status < 400,
      }
    );

    console.log('✅ Proxy: Got devices response:', JSON.stringify(devicesResponse.data).substring(0, 200));

    res.json(devicesResponse.data);
  } catch (error) {
    console.error('Growatt proxy devices error:', error.message);
    console.error('Error response:', error.response?.data);
    res.status(error.response?.status || 500).json({
      message: error.message,
      data: error.response?.data,
    });
  }
});

// Proxy: Get MAX data (getMAXDayChart and getMAXTotalData) - Real-time monitoring endpoint
router.post('/proxy/max/:plantId', authenticate, async (req, res) => {
  try {
    const { plantId } = req.params;
    const { username, password, action } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    if (!action) {
      return res.status(400).json({ message: 'Action is required (getMAXDayChart or getMAXTotalData)' });
    }

    console.log('🔵 Proxy: Getting MAX data for plant:', plantId, 'action:', action);

    // First login to get session and cookies
    const loginResponse = await axios.post(
      `${GROWATT_BASE_URL}/index`,
      new URLSearchParams({
        action: 'login',
        userName: username,
        password: password,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        maxRedirects: 0,
        validateStatus: (status) => status < 400,
      }
    );

    // Extract cookies from login response
    const cookies = loginResponse.headers['set-cookie'] || [];
    let allCookies = [];
    
    cookies.forEach(cookie => {
      const cookieStr = cookie.split(';')[0];
      allCookies.push(cookieStr);
    });

    const cookieString = allCookies.join('; ');

    // Build request data based on action
    let requestData = { action: action };
    if (action === 'getMAXTotalData') {
      requestData.plantId = plantId;
    }

    // Call /panel/max endpoint
    const maxResponse = await axios.post(
      `${GROWATT_BASE_URL}/panel/max`,
      new URLSearchParams(requestData).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          'Origin': 'https://server.growatt.com',
          'Referer': 'https://server.growatt.com/index',
          'Cookie': cookieString,
        },
        maxRedirects: 0,
        validateStatus: (status) => status < 400,
      }
    );

    console.log('✅ Proxy: Got MAX response for', action);

    res.json(maxResponse.data);
  } catch (error) {
    console.error('Growatt proxy MAX error:', error.message);
    console.error('Error response:', error.response?.data);
    res.status(error.response?.status || 500).json({
      message: error.message,
      data: error.response?.data,
    });
  }
});

// Proxy: Get plant data (for plant information including eTotal)
router.post('/proxy/plant-data/:plantId', authenticate, async (req, res) => {
  try {
    const { plantId } = req.params;
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    console.log('🔵 Proxy: Getting plant data for plant:', plantId);

    // First login to get session and cookies
    const loginResponse = await axios.post(
      `${GROWATT_BASE_URL}/index`,
      new URLSearchParams({
        action: 'login',
        userName: username,
        password: password,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        maxRedirects: 0,
        validateStatus: (status) => status < 400,
      }
    );

    // Extract cookies from login response
    const cookies = loginResponse.headers['set-cookie'] || [];
    
    // Extract JSESSIONID and assToken from cookies
    let jsessionId = '';
    let assToken = '';
    let allCookies = [];
    
    cookies.forEach(cookie => {
      const cookieStr = cookie.split(';')[0]; // Get cookie name=value part
      allCookies.push(cookieStr);
      
      if (cookieStr.includes('JSESSIONID=')) {
        jsessionId = cookieStr.split('JSESSIONID=')[1];
      }
      if (cookieStr.includes('assToken=')) {
        assToken = cookieStr.split('assToken=')[1];
      }
    });

    // Build cookie string with all cookies
    const cookieString = allCookies.join('; ');

    console.log('🔵 Proxy: Using cookies for plant data');

    // Use the endpoint: /panel/getPlantData
    const plantDataResponse = await axios.post(
      `${GROWATT_BASE_URL}/panel/getPlantData`,
      new URLSearchParams({
        plantId: plantId,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          'Origin': 'https://server.growatt.com',
          'Referer': 'https://server.growatt.com/index',
          'Cookie': cookieString,
        },
        maxRedirects: 0,
        validateStatus: (status) => status < 400,
      }
    );

    console.log('✅ Proxy: Got plant data response');

    res.json(plantDataResponse.data);
  } catch (error) {
    console.error('Growatt proxy plant data error:', error.message);
    console.error('Error response:', error.response?.data);
    res.status(error.response?.status || 500).json({
      message: error.message,
      data: error.response?.data,
    });
  }
});

// Helper function to fetch plant IDs from Growatt API
async function fetchPlantIds(username, password) {
  try {
    console.log('🔵 Fetching plant IDs for username:', username);
    
    // First login to get session
    const loginResponse = await axios.post(
      `${GROWATT_BASE_URL}/index`,
      new URLSearchParams({
        action: 'login',
        userName: username,
        password: password,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        maxRedirects: 0,
        validateStatus: (status) => status < 400,
      }
    );

    // Extract cookies from login response
    const cookies = loginResponse.headers['set-cookie'] || [];
    let allCookies = [];
    
    cookies.forEach(cookie => {
      const cookieStr = cookie.split(';')[0];
      allCookies.push(cookieStr);
    });

    const cookieString = allCookies.join('; ');

    // Get plant list
    const plantsResponse = await axios.post(
      `${GROWATT_BASE_URL}/index`,
      new URLSearchParams({
        action: 'getPlantList',
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          'Origin': 'https://server.growatt.com',
          'Referer': 'https://server.growatt.com/index',
          'Cookie': cookieString,
        },
        maxRedirects: 0,
        validateStatus: (status) => status < 400,
      }
    );

    // Parse plant list response
    const plantIds = [];
    if (plantsResponse.data) {
      const data = plantsResponse.data;
      
      // Check if response is HTML (login page)
      if (typeof data === 'string' && data.includes('<!DOCTYPE')) {
        console.error('❌ Got HTML response instead of JSON - session not maintained');
        throw new Error('Session expired - got HTML login page instead of plant list');
      }
      
      // Try different response formats
      let plants = [];
      if (data.back && data.back.obj) {
        plants = Array.isArray(data.back.obj) ? data.back.obj : [data.back.obj];
      } else if (data.obj) {
        plants = Array.isArray(data.obj) ? data.obj : [data.obj];
      } else if (Array.isArray(data)) {
        plants = data;
      }
      
      // Extract plant IDs
      plants.forEach((plant) => {
        if (plant.id) {
          plantIds.push(plant.id.toString());
        } else if (plant.plantId) {
          plantIds.push(plant.plantId.toString());
        }
      });
    }

    console.log(`✅ Found ${plantIds.length} plant ID(s):`, plantIds);
    return plantIds;
  } catch (error) {
    console.error('⚠️ Error fetching plant IDs:', error.message);
    // Return empty array if fetch fails
    return [];
  }
}

// Get Growatt credentials for authenticated user
router.get('/credentials', authenticate, async (req, res) => {
  try {
    // Use auth_user_id if available, otherwise use id
    let userId = req.user.auth_user_id || req.user.id;
    if (typeof userId === 'string' && !userId.includes('-')) {
      userId = parseInt(userId, 10);
    } else if (userId && typeof userId === 'string' && userId.includes('-')) {
      if (req.user.auth_user_id) {
        userId = req.user.auth_user_id;
      }
    }

    console.log('🔍 Checking Growatt credentials for user_id:', userId, '(type:', typeof userId, ')');
    console.log('🔍 req.user:', { id: req.user.id, auth_user_id: req.user.auth_user_id });

    // Check if plant_ids column exists
    let hasPlantIdsColumn = false;
    try {
      const columnCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'growatt_credentials' 
        AND column_name = 'plant_ids'
      `);
      hasPlantIdsColumn = columnCheck.rows.length > 0;
    } catch (e) {
      console.log('⚠️ Could not check for plant_ids column:', e.message);
    }

    // Query with or without plant_ids column
    let query;
    if (hasPlantIdsColumn) {
      query = `SELECT id, username, password, 
               COALESCE(plant_ids, '[]'::jsonb) as plant_ids, 
               created_at, updated_at
               FROM growatt_credentials
               WHERE user_id = $1`;
    } else {
      query = `SELECT id, username, password, created_at, updated_at
               FROM growatt_credentials
               WHERE user_id = $1`;
    }

    const result = await pool.query(query, [userId]);

    console.log(`🔍 Found ${result.rows.length} credential record(s) for user_id: ${userId}`);

    if (result.rows.length === 0) {
      return res.json({ 
        hasCredentials: false,
        credentials: null 
      });
    }

    const credentials = result.rows[0];
    let plantIds = [];

    // If plant_ids column exists, parse it
    if (hasPlantIdsColumn) {
      plantIds = credentials.plant_ids || [];
      
      // Only fetch plant IDs if they don't exist in the database
      // If plant_ids already exist, use them directly (don't fetch again)
      if ((!plantIds || plantIds.length === 0) && credentials.username && credentials.password) {
        console.log('🔵 Plant IDs missing, fetching from Growatt API...');
        try {
          const fetchedPlantIds = await fetchPlantIds(credentials.username, credentials.password);
          
          if (fetchedPlantIds.length > 0) {
            // Update the database with fetched plant IDs
            await pool.query(
              `UPDATE growatt_credentials 
               SET plant_ids = $1, updated_at = CURRENT_TIMESTAMP
               WHERE user_id = $2`,
              [JSON.stringify(fetchedPlantIds), userId]
            );
            plantIds = fetchedPlantIds;
            console.log('✅ Plant IDs fetched and saved:', plantIds);
          } else {
            console.log('⚠️ No plant IDs found in Growatt account');
          }
        } catch (error) {
          console.error('⚠️ Failed to fetch plant IDs:', error.message);
          // Continue without plant IDs
        }
      } else if (plantIds && plantIds.length > 0) {
        console.log('✅ Using existing plant IDs from database:', plantIds);
      }
    }

    // Don't return password for security
    res.json({
      hasCredentials: true,
      credentials: {
        id: credentials.id,
        username: credentials.username,
        plantIds: plantIds,
        createdAt: credentials.created_at,
        updatedAt: credentials.updated_at,
      }
    });
  } catch (error) {
    console.error('Get Growatt credentials error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Save/Update Growatt credentials for authenticated user
router.post('/credentials', authenticate, [
  body('username').trim().notEmpty().withMessage('Growatt username is required'),
  body('password').notEmpty().withMessage('Growatt password is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Use auth_user_id if available, otherwise use id
    let userId = req.user.auth_user_id || req.user.id;
    if (typeof userId === 'string' && !userId.includes('-')) {
      userId = parseInt(userId, 10);
    } else if (userId && typeof userId === 'string' && userId.includes('-')) {
      if (req.user.auth_user_id) {
        userId = req.user.auth_user_id;
      }
    }

    console.log('📝 Saving Growatt credentials for user_id:', userId, '(type:', typeof userId, ')');
    console.log('📝 req.user:', { id: req.user.id, auth_user_id: req.user.auth_user_id });

    const username = req.body.username;
    const password = req.body.password;

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    console.log('📝 Saving credentials for username:', username);

    // Check if credentials already exist
    const existing = await pool.query(
      'SELECT id FROM growatt_credentials WHERE user_id = $1',
      [userId]
    );

    if (existing.rows.length > 0) {
      // Update existing credentials
      console.log('📝 Updating existing credentials for user_id:', userId);
      const result = await pool.query(
        `UPDATE growatt_credentials 
         SET username = $1, password = $2, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $3
         RETURNING id, username, created_at, updated_at`,
        [username, password, userId]
      );

      console.log('✅ Credentials updated successfully');
      res.json({
        message: 'Growatt credentials updated successfully',
        credentials: {
          id: result.rows[0].id,
          username: result.rows[0].username,
          createdAt: result.rows[0].created_at,
          updatedAt: result.rows[0].updated_at,
        }
      });
    } else {
      // Insert new credentials
      console.log('📝 Inserting new credentials for user_id:', userId);
      const result = await pool.query(
        `INSERT INTO growatt_credentials (user_id, username, password)
         VALUES ($1, $2, $3)
         RETURNING id, username, created_at, updated_at`,
        [userId, username, password]
      );

      console.log('✅ Credentials saved successfully. ID:', result.rows[0].id);
      res.status(201).json({
        message: 'Growatt credentials saved successfully',
        credentials: {
          id: result.rows[0].id,
          username: result.rows[0].username,
          createdAt: result.rows[0].created_at,
          updatedAt: result.rows[0].updated_at,
        }
      });
    }
  } catch (error) {
    console.error('Save Growatt credentials error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
    });
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// Delete Growatt credentials
router.delete('/credentials', authenticate, async (req, res) => {
  try {
    // Use auth_user_id if available, otherwise use id
    let userId = req.user.auth_user_id || req.user.id;
    if (typeof userId === 'string' && !userId.includes('-')) {
      userId = parseInt(userId, 10);
    } else if (userId && typeof userId === 'string' && userId.includes('-')) {
      if (req.user.auth_user_id) {
        userId = req.user.auth_user_id;
      }
    }

    await pool.query(
      'DELETE FROM growatt_credentials WHERE user_id = $1',
      [userId]
    );

    res.json({ message: 'Growatt credentials deleted successfully' });
  } catch (error) {
    console.error('Delete Growatt credentials error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get Growatt credentials with password (for API calls only - internal use)
router.get('/credentials/with-password', authenticate, async (req, res) => {
  try {
    // Use auth_user_id if available, otherwise use id
    let userId = req.user.auth_user_id || req.user.id;
    if (typeof userId === 'string' && !userId.includes('-')) {
      userId = parseInt(userId, 10);
    } else if (userId && typeof userId === 'string' && userId.includes('-')) {
      if (req.user.auth_user_id) {
        userId = req.user.auth_user_id;
      }
    }

    const result = await pool.query(
      `SELECT username, password
       FROM growatt_credentials
       WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Growatt credentials not found' });
    }

    // Return credentials for internal API use only
    res.json({
      username: result.rows[0].username,
      password: result.rows[0].password,
    });
  } catch (error) {
    console.error('Get Growatt credentials with password error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
