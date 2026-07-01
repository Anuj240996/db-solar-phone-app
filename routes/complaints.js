const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticate } = require('../middleware/auth');
const pool = require('../database/db');
const { buildEngineerFromRow } = require('../utils/profileImage');
const {
  getAppAccessContext,
  getProjectOwnerAuthIds,
  resolveAppUserId,
  resolveAppUserIdForConsumerAuth,
  resolveCustomerFields,
  resolveDefaultCustomerFields,
  resolveAuthUserIdFromCustId,
} = require('../utils/appAccess');

const router = express.Router();

/** Legacy message: [Category: X] [Title: Y] description (with or without blank line). */
const LEGACY_MESSAGE_REGEX =
  /\[Category:\s*([^\]]+)\]\s*\[Title:\s*([^\]]+)\]\s*(?:\n\n|\s+)?(.*)/s;

function getPublicBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function parseHistoryPostingDate(historyRow) {
  const raw =
    historyRow.postingDate ?? historyRow.postingdate ?? historyRow.postingdate_text;
  if (!raw) return null;
  try {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

/** All request track history rows for one complaint (firereport_firetequesthistory). */
async function fetchComplaintRequestHistory(complaintId) {
  try {
    const historyResult = await pool.query(
      `SELECT id, status, remark, "postingDate", postingdate_text, firereport_id, assignto_id, assignby
       FROM firereport_firetequesthistory
       WHERE firereport_id = $1
       ORDER BY "postingDate" ASC NULLS LAST, id ASC`,
      [complaintId]
    );

    return historyResult.rows.map((historyRow) => ({
      id: historyRow.id,
      status: historyRow.status || '',
      remark: historyRow.remark || '',
      postingdate: parseHistoryPostingDate(historyRow),
      firereportId: historyRow.firereport_id,
      assignToId: historyRow.assignto_id,
      assignBy: historyRow.assignby,
    }));
  } catch (historyError) {
    console.error('⚠️ Error fetching request history:', historyError.message);
    return [];
  }
}

// Helper function to get auth_user_id from req.user
function getAuthUserId(req) {
  if (req.user.auth_user_id) {
    return req.user.auth_user_id;
  } else if (req.user.id && typeof req.user.id === 'number') {
    return req.user.id;
  } else if (req.user.id && typeof req.user.id === 'string') {
    const userIdNum = parseInt(req.user.id, 10);
    if (!isNaN(userIdNum) && req.user.id === userIdNum.toString()) {
      return userIdNum;
    }
  }
  return null;
}

// Configure multer for file uploads
const uploadDir = path.join(__dirname, '..', 'uploads', 'complaints');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only image files are allowed'));
  },
});

/** JSON body when no images; multipart only when client sends files. */
function optionalComplaintUpload(req, res, next) {
  const contentType = (req.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('multipart/form-data')) {
    return next();
  }
  return upload.array('images', 5)(req, res, (err) => {
    if (err) {
      console.error('Complaint upload error:', err.message);
      return res.status(400).json({ message: err.message || 'Invalid image upload' });
    }
    next();
  });
}

// Get all complaints for user from firereport_firereport table
function buildComplaintListAccessWhere(accountIdCol) {
  return `(
    f.app_user_id = $1
    OR ($1 IS NULL AND (
      f.${accountIdCol} = $2
      OR f.${accountIdCol} = ANY($3::int[])
    ))
    OR (f.app_user_id IS NULL AND (
      f.${accountIdCol} = $2
      OR f.${accountIdCol} = ANY($3::int[])
    ))
  )
  AND ($4::int IS NULL OR f.${accountIdCol} = $4)`;
}

function buildComplaintDetailAccessWhere(accountIdCol) {
  return `(
    f.app_user_id = $2
    OR ($2 IS NULL AND (
      f.${accountIdCol} = $3
      OR f.${accountIdCol} = ANY($4::int[])
    ))
    OR (f.app_user_id IS NULL AND (
      f.${accountIdCol} = $3
      OR f.${accountIdCol} = ANY($4::int[])
    ))
  )`;
}

router.get('/', authenticate, async (req, res) => {
  try {
    const ctx = await getAppAccessContext(req);
    if (!ctx) {
      return res.status(401).json({ message: 'Could not identify user' });
    }
    const resolvedAppUserId = await resolveAppUserId(req);
    const accountIds = [ctx.appOwnerId, ...ctx.linkedAuthIds];

    let filterAuthUserId = null;
    const filterCustId = req.query.cust_id ? parseInt(req.query.cust_id, 10) : null;
    if (filterCustId && !isNaN(filterCustId)) {
      filterAuthUserId = await resolveAuthUserIdFromCustId(
        filterCustId,
        ctx.appOwnerId,
        ctx.linkedAuthIds
      );
    }

    // Get all column names to verify exact casing
    const allColumnsResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public'
      AND table_name = 'firereport_firereport'
      ORDER BY ordinal_position
    `);
    const allColumns = allColumnsResult.rows.map(r => r.column_name);
    
    // Create a map of column names (case-insensitive lookup)
    const columnMap = {};
    allColumns.forEach(col => {
      columnMap[col.toLowerCase()] = col; // Store original case
    });
    
    // Helper to get column name with proper quoting
    const getColumnName = (name) => {
      const lowerName = name.toLowerCase();
      if (columnMap[lowerName]) {
        const actualName = columnMap[lowerName];
        // If it has mixed case or starts with capital, quote it
        if (actualName !== actualName.toLowerCase()) {
          return `"${actualName}"`;
        }
        return actualName;
      }
      return name; // Return as-is if not found
    };
    
    // Check if category and title columns exist
    const hasCategory = allColumns.some(col => col.toLowerCase() === 'category');
    const hasTitle = allColumns.some(col => col.toLowerCase() === 'title');
    if (!allColumns.some(col => col.toLowerCase() === 'app_user_id')) {
      try {
        await pool.query(`ALTER TABLE firereport_firereport ADD COLUMN IF NOT EXISTS app_user_id INTEGER`);
      } catch (_) { /* ignore */ }
    }

    // Build column names using actual database column names
    const idCol = getColumnName('id');
    const fullNameCol = getColumnName('fullname') || getColumnName('FullName') || 'fullname';
    const mobileCol = getColumnName('mobilenumber') || getColumnName('MobileNumber') || 'mobilenumber';
    const locationCol = getColumnName('Location') || getColumnName('location') || 'Location';
    const messageCol = getColumnName('message') || getColumnName('Message') || 'message';
    const statusCol = getColumnName('status') || getColumnName('Status') || 'status';
    const postingDateCol = getColumnName('postingdate') || getColumnName('Postingdate') || 'postingdate';
    const accountIdCol = getColumnName('account_id') || getColumnName('Account_id') || 'account_id';
    const assignByCol = getColumnName('assignby') || getColumnName('AssignBy') || 'assignby';
    const updationDateCol = getColumnName('updationdate') || getColumnName('UpdationDate') || 'updationdate';
    const assignToIdCol = getColumnName('assignto_id') || getColumnName('AssignTo_id') || 'assignto_id';
    const assignedTimeCol = getColumnName('assignedtime') || getColumnName('AssignedTime') || 'assignedtime';

    // Check user_profile table and find foreign key to auth_user
    let userProfileFkColumn = null;
    let userProfileJoin = '';
    let userProfileSelect = '';
    try {
      const userProfileCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'user_profile'
      `);
      const userProfileColumns = userProfileCheck.rows.map(r => r.column_name);
      
      // Try to find the foreign key column - customer_id is the FK to auth_user
      const possibleFkNames = ['customer_id', 'user_id', 'auth_user_id', 'user', 'auth_user'];
      for (const fkName of possibleFkNames) {
        const foundCol = userProfileColumns.find(col => col.toLowerCase() === fkName.toLowerCase());
        if (foundCol) {
          userProfileFkColumn = foundCol;
          console.log(`✅ Found user_profile foreign key column: ${foundCol}`);
          break;
        }
      }
      
      if (userProfileFkColumn) {
        console.log(`✅ Found user_profile foreign key: ${userProfileFkColumn}`);
        console.log(`📋 Available user_profile columns: ${userProfileColumns.join(', ')}`);
        
        // Helper to get column name with proper quoting
        const getUserProfileColumn = (possibleNames) => {
          for (const name of possibleNames) {
            const found = userProfileColumns.find(col => col.toLowerCase() === name.toLowerCase());
            if (found) {
              // Quote if needed (mixed case)
              return found !== found.toLowerCase() ? `"${found}"` : found;
            }
          }
          return null;
        };
        
        // Build SELECT fields for user_profile
        const selectFields = [];
        
        // Contact number - try multiple possible column names
        const contactCol = getUserProfileColumn(['contact_number', 'phone', 'mobile', 'contact', 'phone_number']);
        if (contactCol) {
          selectFields.push(`up.${contactCol} as engineer_contact_number`);
          console.log(`✅ Found contact column: ${contactCol}`);
        }
        
        // Address
        const addressCol = getUserProfileColumn(['address', 'location', 'full_address']);
        if (addressCol) {
          selectFields.push(`up.${addressCol} as engineer_address`);
          console.log(`✅ Found address column: ${addressCol}`);
        }
        
        // Designation
        const designationCol = getUserProfileColumn(['designation', 'job_title', 'position', 'role']);
        if (designationCol) {
          selectFields.push(`up.${designationCol} as engineer_designation`);
          console.log(`✅ Found designation column: ${designationCol}`);
        }

        const profileNameCol = getUserProfileColumn(['name']);
        if (profileNameCol) {
          selectFields.push(`up.${profileNameCol} as engineer_profile_name`);
        }
        
        // Image
        const imageCol = getUserProfileColumn(['image', 'image_path', 'photo', 'avatar', 'profile_picture']);
        if (imageCol) {
          selectFields.push(`up.${imageCol} as engineer_image`);
          console.log(`✅ Found image column: ${imageCol}`);
        }
        
        if (selectFields.length > 0) {
          userProfileSelect = ', ' + selectFields.join(', ');
          // Quote the FK column if needed
          const quotedFk = userProfileFkColumn !== userProfileFkColumn.toLowerCase() 
            ? `"${userProfileFkColumn}"` 
            : userProfileFkColumn;
          // JOIN: user_profile.customer_id = auth_user.id (where customer_id is FK to auth_user)
          userProfileJoin = `LEFT JOIN user_profile up ON au.id = up.${quotedFk}`;
          console.log(`✅ user_profile JOIN added: ${userProfileJoin}`);
          console.log(`   JOIN condition: auth_user.id = user_profile.${quotedFk}`);
          console.log(`✅ user_profile SELECT fields: ${userProfileSelect}`);
        } else {
          console.log('⚠️ No matching columns found in user_profile');
        }
      } else {
        console.log('⚠️ Could not find foreign key in user_profile table');
      }
    } catch (err) {
      console.log('⚠️ Could not check user_profile table:', err.message);
    }

    // Build query based on available columns - using actual table field names
    // Include LEFT JOIN with auth_user to get engineer information
    let query;
    const categoryCol = getColumnName('category') || 'category';
    const titleCol = getColumnName('title') || 'title';
    const warrantyTypeCol = getColumnName('warranty_type') || 'warranty_type';
    const appUserIdCol = getColumnName('app_user_id') || 'app_user_id';
    const accessWhere = buildComplaintListAccessWhere(accountIdCol);

    if (hasCategory && hasTitle) {
      query = `
        SELECT 
          f.${idCol},
          f.${fullNameCol},
          f.${mobileCol},
          f.${locationCol},
          f.${messageCol},
          f.${statusCol},
          f.${postingDateCol},
          f.${accountIdCol},
          f.${categoryCol},
          f.${titleCol},
          f.${warrantyTypeCol},
          f.${appUserIdCol},
          f.${updationDateCol},
          f.${assignByCol},
          f.${assignToIdCol},
          f.${assignedTimeCol},
          au.id as engineer_id,
          au.first_name as engineer_first_name,
          au.last_name as engineer_last_name,
          au.email as engineer_email,
          au.username as engineer_username${userProfileSelect}
        FROM firereport_firereport f
        LEFT JOIN auth_user au ON f.${assignToIdCol} = au.id
        ${userProfileJoin}
        WHERE ${accessWhere}
        ORDER BY f.${postingDateCol} DESC
      `;
    } else {
      query = `
        SELECT 
          f.${idCol},
          f.${fullNameCol},
          f.${mobileCol},
          f.${locationCol},
          f.${messageCol},
          f.${statusCol},
          f.${postingDateCol},
          f.${accountIdCol},
          f.${warrantyTypeCol},
          f.${appUserIdCol},
          f.${updationDateCol},
          f.${assignByCol},
          f.${assignToIdCol},
          f.${assignedTimeCol},
          au.id as engineer_id,
          au.first_name as engineer_first_name,
          au.last_name as engineer_last_name,
          au.email as engineer_email,
          au.username as engineer_username${userProfileSelect}
        FROM firereport_firereport f
        LEFT JOIN auth_user au ON f.${assignToIdCol} = au.id
        ${userProfileJoin}
        WHERE ${accessWhere}
        ORDER BY f.${postingDateCol} DESC
      `;
    }

    const queryParams = [
      resolvedAppUserId,
      ctx.appOwnerId,
      accountIds,
      filterAuthUserId && !isNaN(filterAuthUserId) ? filterAuthUserId : null,
    ];
    console.log('📝 Executing query:', query.replace(/\s+/g, ' ').substring(0, 200) + '...');
    console.log('📝 Query parameters:', queryParams);
    
    const result = await pool.query(query, queryParams);
    
    // Debug: Log first row structure if available
    if (result.rows.length > 0) {
      console.log('📊 First row keys:', Object.keys(result.rows[0]));
      // Log engineer-related keys
      const engineerKeys = Object.keys(result.rows[0]).filter(k => k.toLowerCase().includes('engineer'));
      console.log('👤 Engineer-related keys in row:', engineerKeys);
      if (engineerKeys.length > 0) {
        const sampleRow = result.rows[0];
        engineerKeys.forEach(key => {
          console.log(`  ${key}: ${sampleRow[key]}`);
        });
      }
    }

    // Map firereport_firereport data to complaint format
    const complaints = result.rows.map((row) => {
      // Extract category and title from message if columns don't exist
      let category = '';
      let title = '';
      let description = row.message || '';

      // Get values using case-insensitive lookup
      const getValue = (row, colName) => {
        const keys = Object.keys(row);
        const foundKey = keys.find(k => k.toLowerCase() === colName.toLowerCase());
        return foundKey ? row[foundKey] : null;
      };

      // Get raw message from database
      const rawMessage = getValue(row, 'message') || '';
      
      // Try to parse category and title from message format first: [Category: X] [Title: Y]\n\nDescription
      const messageMatch = rawMessage?.match(LEGACY_MESSAGE_REGEX);

      if (hasCategory && hasTitle) {
        const dbCategory = (getValue(row, 'category') || '').trim();
        const dbTitle = (getValue(row, 'title') || '').trim();

        if (dbCategory) {
          category = dbCategory;
        } else if (messageMatch && messageMatch[1]) {
          category = messageMatch[1].trim();
        }

        if (dbTitle) {
          title = dbTitle;
        } else if (messageMatch && messageMatch[2]) {
          title = messageMatch[2].trim();
        }

        if (messageMatch) {
          description = (messageMatch[3] || '').trim();
        } else {
          description = rawMessage.trim();
        }
      } else if (messageMatch) {
        category = messageMatch[1].trim();
        title = messageMatch[2].trim();
        description = (messageMatch[3] || '').trim();
      } else {
        description = rawMessage.trim() || '';
      }

        const postingDate = getValue(row, 'postingdate');
        const assignToId = getValue(row, 'assignto_id');
        const assignedTime = getValue(row, 'assignedtime');
        
        const engineer = buildEngineerFromRow(row, assignToId, getValue, getPublicBaseUrl(req));

        return {
        id: getValue(row, 'id') || row.id,
        userId: getValue(row, 'account_id'),
        appUserId: getValue(row, 'app_user_id'),
        category: category,
        warrantyType: getValue(row, 'warranty_type') || '',
        title: title || `Complaint #${getValue(row, 'id') || row.id}`,
        description: description,
        message: description, // Use cleaned description as message (not the raw message with category/title)
        status: (getValue(row, 'status') || 'Pending').toLowerCase(),
        createdAt: postingDate ? new Date(postingDate).toISOString() : new Date().toISOString(),
        postingdate: postingDate ? new Date(postingDate).toISOString() : new Date().toISOString(), // Add postingdate field from database
        updatedAt: getValue(row, 'updationdate') ? new Date(getValue(row, 'updationdate')).toISOString() : null,
        adminResponse: null, // Not available in firereport_firereport
        imageUrls: [], // Images not stored in firereport_firereport
        fullName: getValue(row, 'fullname') || '',
        mobileNumber: getValue(row, 'mobilenumber') || '',
        location: getValue(row, 'Location') || getValue(row, 'location') || '',
        updates: [], // Updates not stored in firereport_firereport
        assignToId: assignToId,
        assignedTime: assignedTime ? new Date(assignedTime).toISOString() : null,
        engineer: engineer,
      };
    });

    res.json({ complaints });
  } catch (error) {
    console.error('❌ Get complaints error:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint,
    });
    res.status(500).json({ 
      message: 'Server error while fetching complaints',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      detail: process.env.NODE_ENV === 'development' ? error.detail : undefined,
    });
  }
});

// Get single complaint from firereport_firereport table
// Service requests (firereport_servicerequest) — alias when /api/services is not mounted
router.use('/service-requests', require('./services'));

router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ctx = await getAppAccessContext(req);
    if (!ctx) {
      return res.status(401).json({ message: 'Could not identify user' });
    }
    const resolvedAppUserId = await resolveAppUserId(req);
    const accountIds = [ctx.appOwnerId, ...ctx.linkedAuthIds];

    // Get all column names to verify exact casing
    const allColumnsResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public'
      AND table_name = 'firereport_firereport'
      ORDER BY ordinal_position
    `);
    const allColumns = allColumnsResult.rows.map(r => r.column_name);
    
    // Create a map of column names (case-insensitive lookup)
    const columnMap = {};
    allColumns.forEach(col => {
      columnMap[col.toLowerCase()] = col; // Store original case
    });
    
    // Helper to get column name with proper quoting
    const getColumnName = (name) => {
      const lowerName = name.toLowerCase();
      if (columnMap[lowerName]) {
        const actualName = columnMap[lowerName];
        // If it has mixed case or starts with capital, quote it
        if (actualName !== actualName.toLowerCase()) {
          return `"${actualName}"`;
        }
        return actualName;
      }
      return name; // Return as-is if not found
    };
    
    // Check if category and title columns exist
    const hasCategory = allColumns.some(col => col.toLowerCase() === 'category');
    const hasTitle = allColumns.some(col => col.toLowerCase() === 'title');

    // Build column names using actual database column names
    const idCol = getColumnName('id');
    const fullNameCol = getColumnName('fullname') || getColumnName('FullName') || 'fullname';
    const mobileCol = getColumnName('mobilenumber') || getColumnName('MobileNumber') || 'mobilenumber';
    const locationCol = getColumnName('Location') || getColumnName('location') || 'Location';
    const messageCol = getColumnName('message') || getColumnName('Message') || 'message';
    const statusCol = getColumnName('status') || getColumnName('Status') || 'status';
    const postingDateCol = getColumnName('postingdate') || getColumnName('Postingdate') || 'postingdate';
    const accountIdCol = getColumnName('account_id') || getColumnName('Account_id') || 'account_id';
    const assignByCol = getColumnName('assignby') || getColumnName('AssignBy') || 'assignby';
    const updationDateCol = getColumnName('updationdate') || getColumnName('UpdationDate') || 'updationdate';
    const assignToIdCol = getColumnName('assignto_id') || getColumnName('AssignTo_id') || 'assignto_id';
    const assignedTimeCol = getColumnName('assignedtime') || getColumnName('AssignedTime') || 'assignedtime';

    // Check user_profile table and find foreign key to auth_user
    let userProfileFkColumn = null;
    let userProfileJoin = '';
    let userProfileSelect = '';
    try {
      const userProfileCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'user_profile'
      `);
      const userProfileColumns = userProfileCheck.rows.map(r => r.column_name);
      
      // Try to find the foreign key column - customer_id is the FK to auth_user
      const possibleFkNames = ['customer_id', 'user_id', 'auth_user_id', 'user', 'auth_user'];
      for (const fkName of possibleFkNames) {
        const foundCol = userProfileColumns.find(col => col.toLowerCase() === fkName.toLowerCase());
        if (foundCol) {
          userProfileFkColumn = foundCol;
          console.log(`✅ Found user_profile foreign key column: ${foundCol}`);
          break;
        }
      }
      
      if (userProfileFkColumn) {
        console.log(`✅ Found user_profile foreign key: ${userProfileFkColumn}`);
        console.log(`📋 Available user_profile columns: ${userProfileColumns.join(', ')}`);
        
        // Helper to get column name with proper quoting
        const getUserProfileColumn = (possibleNames) => {
          for (const name of possibleNames) {
            const found = userProfileColumns.find(col => col.toLowerCase() === name.toLowerCase());
            if (found) {
              // Quote if needed (mixed case)
              return found !== found.toLowerCase() ? `"${found}"` : found;
            }
          }
          return null;
        };
        
        // Build SELECT fields for user_profile
        const selectFields = [];
        
        // Contact number - try multiple possible column names
        const contactCol = getUserProfileColumn(['contact_number', 'phone', 'mobile', 'contact', 'phone_number']);
        if (contactCol) {
          selectFields.push(`up.${contactCol} as engineer_contact_number`);
          console.log(`✅ Found contact column: ${contactCol}`);
        }
        
        // Address
        const addressCol = getUserProfileColumn(['address', 'location', 'full_address']);
        if (addressCol) {
          selectFields.push(`up.${addressCol} as engineer_address`);
          console.log(`✅ Found address column: ${addressCol}`);
        }
        
        // Designation
        const designationCol = getUserProfileColumn(['designation', 'job_title', 'position', 'role']);
        if (designationCol) {
          selectFields.push(`up.${designationCol} as engineer_designation`);
          console.log(`✅ Found designation column: ${designationCol}`);
        }

        const profileNameCol = getUserProfileColumn(['name']);
        if (profileNameCol) {
          selectFields.push(`up.${profileNameCol} as engineer_profile_name`);
        }
        
        // Image
        const imageCol = getUserProfileColumn(['image', 'image_path', 'photo', 'avatar', 'profile_picture']);
        if (imageCol) {
          selectFields.push(`up.${imageCol} as engineer_image`);
          console.log(`✅ Found image column: ${imageCol}`);
        }
        
        if (selectFields.length > 0) {
          userProfileSelect = ', ' + selectFields.join(', ');
          // Quote the FK column if needed
          const quotedFk = userProfileFkColumn !== userProfileFkColumn.toLowerCase() 
            ? `"${userProfileFkColumn}"` 
            : userProfileFkColumn;
          // JOIN: user_profile.customer_id = auth_user.id (where customer_id is FK to auth_user)
          userProfileJoin = `LEFT JOIN user_profile up ON au.id = up.${quotedFk}`;
          console.log(`✅ user_profile JOIN added: ${userProfileJoin}`);
          console.log(`   JOIN condition: auth_user.id = user_profile.${quotedFk}`);
          console.log(`✅ user_profile SELECT fields: ${userProfileSelect}`);
        } else {
          console.log('⚠️ No matching columns found in user_profile');
        }
      } else {
        console.log('⚠️ Could not find foreign key in user_profile table');
      }
    } catch (err) {
      console.log('⚠️ Could not check user_profile table:', err.message);
    }

    const categoryCol = getColumnName('category') || 'category';
    const titleCol = getColumnName('title') || 'title';
    const warrantyTypeCol = getColumnName('warranty_type') || 'warranty_type';
    const appUserIdCol = getColumnName('app_user_id') || 'app_user_id';
    const detailAccessWhere = buildComplaintDetailAccessWhere(accountIdCol);

    let query;
    if (hasCategory && hasTitle) {
      query = `
        SELECT 
          f.${idCol},
          f.${fullNameCol},
          f.${mobileCol},
          f.${locationCol},
          f.${messageCol},
          f.${statusCol},
          f.${postingDateCol},
          f.${accountIdCol},
          f.${categoryCol},
          f.${titleCol},
          f.${warrantyTypeCol},
          f.${appUserIdCol},
          f.${updationDateCol},
          f.${assignByCol},
          f.${assignToIdCol},
          f.${assignedTimeCol},
          f.progress_date,
          f.working_date,
          f.complete_date,
          au.id as engineer_id,
          au.first_name as engineer_first_name,
          au.last_name as engineer_last_name,
          au.email as engineer_email,
          au.username as engineer_username${userProfileSelect}
        FROM firereport_firereport f
        LEFT JOIN auth_user au ON f.${assignToIdCol} = au.id
        ${userProfileJoin || ''}
        WHERE f.${idCol} = $1 AND ${detailAccessWhere}
      `;
    } else {
      query = `
        SELECT 
          f.${idCol},
          f.${fullNameCol},
          f.${mobileCol},
          f.${locationCol},
          f.${messageCol},
          f.${statusCol},
          f.${postingDateCol},
          f.${accountIdCol},
          f.${warrantyTypeCol},
          f.${appUserIdCol},
          f.${updationDateCol},
          f.${assignByCol},
          f.${assignToIdCol},
          f.${assignedTimeCol},
          f.progress_date,
          f.working_date,
          f.complete_date,
          au.id as engineer_id,
          au.first_name as engineer_first_name,
          au.last_name as engineer_last_name,
          au.email as engineer_email,
          au.username as engineer_username${userProfileSelect}
        FROM firereport_firereport f
        LEFT JOIN auth_user au ON f.${assignToIdCol} = au.id
        ${userProfileJoin || ''}
        WHERE f.${idCol} = $1 AND ${detailAccessWhere}
      `;
    }

    const queryParams = [id, resolvedAppUserId, ctx.appOwnerId, accountIds];
    console.log('📝 Executing GET /:id query:', query.replace(/\s+/g, ' ').substring(0, 200) + '...');
    console.log('📝 Query parameters:', queryParams);
    
    const result = await pool.query(query, queryParams);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Complaint not found' });
    }

    const row = result.rows[0];
    
    // Debug: Log row structure
    console.log('📊 Row keys:', Object.keys(row));
    const engineerKeys = Object.keys(row).filter(k => 
      k.toLowerCase().includes('engineer') || 
      k.toLowerCase().includes('contact') ||
      k.toLowerCase().includes('address') ||
      k.toLowerCase().includes('designation')
    );
    console.log('👤 Engineer-related keys in row:', engineerKeys);
    if (engineerKeys.length > 0) {
      engineerKeys.forEach(key => {
        console.log(`  ${key}: ${row[key]}`);
      });
    }

    // Helper to get value using case-insensitive lookup
    const getValue = (row, colName) => {
      const keys = Object.keys(row);
      const foundKey = keys.find(k => k.toLowerCase() === colName.toLowerCase());
      return foundKey ? row[foundKey] : null;
    };

    // Get raw message from database
    const rawMessage = getValue(row, 'message') || '';
    
    // Try to parse category and title from message format first: [Category: X] [Title: Y]\n\nDescription
    const messageMatch = rawMessage?.match(LEGACY_MESSAGE_REGEX);

    let category = '';
    let title = '';
    let description = '';

    if (hasCategory && hasTitle) {
      const dbCategory = (getValue(row, 'category') || '').trim();
      const dbTitle = (getValue(row, 'title') || '').trim();

      if (dbCategory) {
        category = dbCategory;
      } else if (messageMatch && messageMatch[1]) {
        category = messageMatch[1].trim();
      }

      if (dbTitle) {
        title = dbTitle;
      } else if (messageMatch && messageMatch[2]) {
        title = messageMatch[2].trim();
      }

      if (messageMatch) {
        description = (messageMatch[3] || '').trim();
      } else {
        description = rawMessage.trim();
      }
    } else if (messageMatch) {
      category = messageMatch[1].trim();
      title = messageMatch[2].trim();
      description = (messageMatch[3] || '').trim();
    } else {
      description = rawMessage.trim() || '';
    }

    const postingDate = getValue(row, 'postingdate');
    const assignToId = getValue(row, 'assignto_id');
    const assignedTime = getValue(row, 'assignedtime');
    const progressDate = getValue(row, 'progress_date');
    const workingDate = getValue(row, 'working_date');
    const completeDate = getValue(row, 'complete_date');
    
    const complaintId = getValue(row, 'id') || row.id;
    const requestHistory = await fetchComplaintRequestHistory(complaintId);
    console.log(`✅ Fetched ${requestHistory.length} history records for complaint ${complaintId}`);

    const engineer = buildEngineerFromRow(row, assignToId, getValue, getPublicBaseUrl(req));

    res.json({
      complaint: {
        id: getValue(row, 'id') || row.id,
        userId: getValue(row, 'account_id'),
        appUserId: getValue(row, 'app_user_id'),
        category: category,
        warrantyType: getValue(row, 'warranty_type') || '',
        title: title || `Complaint #${getValue(row, 'id') || row.id}`,
        description: description,
        message: description, // Use cleaned description as message (not the raw message with category/title)
        status: (getValue(row, 'status') || 'Pending').toLowerCase(),
        createdAt: postingDate ? new Date(postingDate).toISOString() : new Date().toISOString(),
        postingdate: postingDate ? new Date(postingDate).toISOString() : new Date().toISOString(), // Add postingdate field from database
        updatedAt: getValue(row, 'updationdate') ? new Date(getValue(row, 'updationdate')).toISOString() : null,
        adminResponse: null, // Not available in firereport_firereport
        imageUrls: [], // Images not stored in firereport_firereport
        fullName: getValue(row, 'fullname') || '',
        mobileNumber: getValue(row, 'mobilenumber') || '',
        location: getValue(row, 'Location') || getValue(row, 'location') || '',
        updates: [], // Updates not stored in firereport_firereport
        assignToId: assignToId,
        assignedTime: assignedTime ? new Date(assignedTime).toISOString() : null,
        engineer: engineer,
        progressDate: progressDate ? new Date(progressDate).toISOString() : null,
        workingDate: workingDate ? new Date(workingDate).toISOString() : null,
        completeDate: completeDate ? new Date(completeDate).toISOString() : null,
        requestHistory: requestHistory,
      },
    });
  } catch (error) {
    console.error('❌ Get complaint error:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint,
    });
    res.status(500).json({ 
      message: 'Server error while fetching complaint',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      detail: process.env.NODE_ENV === 'development' ? error.detail : undefined,
    });
  }
});

// Create complaint
router.post('/', authenticate, optionalComplaintUpload, async (req, res) => {
  try {
    const { category, title, description } = req.body;
    const warrantyType =
      req.body.warrantyType != null ? String(req.body.warrantyType).trim() : '';

    if (!category || !title || !description) {
      return res.status(400).json({ message: 'Category, title, and description are required' });
    }
    if (!warrantyType) {
      return res.status(400).json({ message: 'Please select a warranty type' });
    }

    await pool.query(`ALTER TABLE firereport_firereport ADD COLUMN IF NOT EXISTS category VARCHAR(255)`);
    await pool.query(`ALTER TABLE firereport_firereport ADD COLUMN IF NOT EXISTS title VARCHAR(255)`);
    await pool.query(`ALTER TABLE firereport_firereport ADD COLUMN IF NOT EXISTS warranty_type TEXT`);
    await pool.query(`ALTER TABLE firereport_firereport ADD COLUMN IF NOT EXISTS app_user_id INTEGER`);
    await pool.query(`ALTER TABLE firereport_firereport ALTER COLUMN assignby DROP NOT NULL`).catch(() => {});

    const ctx = await getAppAccessContext(req);
    if (!ctx) {
      return res.status(401).json({ message: 'Could not identify user' });
    }

    const custId = req.body.cust_id ? parseInt(req.body.cust_id, 10) : null;
    let customerFields;
    try {
      if (custId && !isNaN(custId)) {
        customerFields = await resolveCustomerFields(
          ctx.appOwnerId,
          ctx.linkedAuthIds,
          custId,
          req,
          ctx
        );
      } else {
        customerFields = await resolveDefaultCustomerFields(req, ctx);
      }
    } catch (custErr) {
      const msg = custErr.message || 'Invalid consumer';
      const status = msg.includes('linked')
        ? 403
        : msg.includes('not found')
          ? 404
          : 400;
      return res.status(status).json({ message: msg });
    }

    const { fullName, mobileNumber, location, authUserId: consumerAuthUserId } = customerFields;
    let appUserId = await resolveAppUserId(req);
    if (appUserId == null) {
      appUserId = await resolveAppUserIdForConsumerAuth(consumerAuthUserId);
    }
    const accountId = consumerAuthUserId;
    const status = 'Pending';
    
    // Set appropriate dates based on field names
    // Postingdate: Date when complaint is created (current date/time)
    const postingDate = new Date().toISOString();
    // UpdationDate: Date when complaint is updated (NULL initially, set when updated)
    const updationDate = null;
    // AssignedTime: Time when complaint is assigned (NULL initially)
    const assignedTime = null;
    // progress_date: Date when complaint is in progress (NULL initially)
    const progressDate = null;
    // working_date: Date when work starts (NULL initially)
    const workingDate = null;
    // complete_date: Date when complaint is completed (NULL initially)
    const completeDate = null;
    
    if (!accountId) {
      return res.status(400).json({
        message: 'Could not resolve consumer account. Please select a consumer.',
        error: 'accountId is null',
      });
    }

    console.log('👤 Complaint account_id (consumer auth_user):', accountId);
    console.log('👤 Complaint app_user_id (user_app):', appUserId);

    // Get the next ID for firereport_firereport
    const maxIdResult = await pool.query(
      `SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM firereport_firereport`
    );
    const nextId = maxIdResult.rows[0].next_id;

    // ALWAYS ensure category and title columns exist - create them if they don't
    console.log('🔧 Ensuring category and title columns exist...');
    try {
      await pool.query(`ALTER TABLE firereport_firereport ADD COLUMN IF NOT EXISTS category VARCHAR(255)`);
      console.log('✅ Category column ensured');
    } catch (err) {
      console.error('❌ Error ensuring category column:', err.message);
    }
    
    try {
      await pool.query(`ALTER TABLE firereport_firereport ADD COLUMN IF NOT EXISTS title VARCHAR(255)`);
      console.log('✅ Title column ensured');
    } catch (err) {
      console.error('❌ Error ensuring title column:', err.message);
    }

    try {
      await pool.query(`ALTER TABLE firereport_firereport ADD COLUMN IF NOT EXISTS warranty_type TEXT`);
      console.log('✅ warranty_type column ensured');
    } catch (err) {
      console.error('❌ Error ensuring warranty_type column:', err.message);
    }

    try {
      await pool.query(`ALTER TABLE firereport_firereport ADD COLUMN IF NOT EXISTS app_user_id INTEGER`);
      console.log('✅ app_user_id column ensured');
    } catch (err) {
      console.error('❌ Error ensuring app_user_id column:', err.message);
    }

    try {
      await pool.query(`ALTER TABLE firereport_firereport ALTER COLUMN assignby DROP NOT NULL`);
      console.log('✅ assignby column allows NULL');
    } catch (err) {
      console.warn('assignby nullable migration:', err.message);
    }
    
    // Check if category and title columns exist in firereport_firereport
    // Also get actual column names to handle case sensitivity
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public'
      AND table_name = 'firereport_firereport' 
      AND column_name IN ('category', 'title')
    `);
    
    const hasCategory = columnCheck.rows.some(row => row.column_name === 'category');
    const hasTitle = columnCheck.rows.some(row => row.column_name === 'title');
    
    if (!hasCategory || !hasTitle) {
      console.error('❌ CRITICAL: Category or title columns still not found after creation attempt!');
      throw new Error('Category and title columns must exist. Please check database.');
    }

    // Get all column names to verify exact casing
    const allColumnsResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public'
      AND table_name = 'firereport_firereport'
      ORDER BY ordinal_position
    `);
    const allColumns = allColumnsResult.rows.map(r => r.column_name);
    console.log('📋 Available columns in firereport_firereport:', allColumns);
    console.log('🔍 Has category:', hasCategory, 'Has title:', hasTitle);
    
    // Create a map of column names (case-insensitive lookup)
    const columnMap = {};
    allColumns.forEach(col => {
      columnMap[col.toLowerCase()] = col; // Store original case
    });
    
    // Helper to get column name with proper quoting
    const getColumnName = (name) => {
      const lowerName = name.toLowerCase();
      if (columnMap[lowerName]) {
        const actualName = columnMap[lowerName];
        // If it has mixed case or starts with capital, quote it
        if (actualName !== actualName.toLowerCase()) {
          return `"${actualName}"`;
        }
        return actualName;
      }
      return name; // Return as-is if not found
    };

    // Insert into firereport_firereport table only
    let insertQuery;
    let insertParams;
    let insertedId;

    // Build column names using actual database column names
    // Based on actual table: id, fullname, mobilenumber, "Location", message, status, postingdate, account_id, assignby
    const idCol = getColumnName('id') || 'id';
    const fullNameCol = getColumnName('fullname') || getColumnName('FullName') || 'fullname';
    const mobileCol = getColumnName('mobilenumber') || getColumnName('MobileNumber') || 'mobilenumber';
    const locationCol = getColumnName('Location') || getColumnName('location') || 'Location';
    const messageCol = getColumnName('message') || getColumnName('Message') || 'message';
    const statusCol = getColumnName('status') || getColumnName('Status') || 'status';
    const postingDateCol = getColumnName('postingdate') || getColumnName('Postingdate') || 'postingdate';
    const accountIdCol = getColumnName('account_id') || getColumnName('Account_id') || 'account_id';
    // Get assignby column name - must be lowercase 'assignby' based on table structure
    const assignByCol = getColumnName('assignby') || 'assignby';
    
    // Log column names for debugging
    console.log('🔍 Column name detection:');
    console.log('   assignby column:', assignByCol);
    console.log('   account_id column:', accountIdCol);
    console.log('   accountId value:', accountId);
    console.log('   accountId type:', typeof accountId);
    
    // Validate all column names are defined
    const columnNames = { idCol, fullNameCol, mobileCol, locationCol, messageCol, statusCol, postingDateCol, accountIdCol, assignByCol };
    const undefinedCols = Object.entries(columnNames).filter(([key, value]) => !value || value === 'undefined');
    if (undefinedCols.length > 0) {
      console.error('❌ Undefined column names:', undefinedCols);
      throw new Error(`Undefined column names: ${undefinedCols.map(([k]) => k).join(', ')}`);
    }
    
    console.log('🔧 Using column names:', columnNames);
    
    // Insert complaint - ALWAYS save category, title, and description in separate fields
    // Category → category column
    // Title → title column  
    // Description → message column (ONLY description, no category/title metadata)
    // CRITICAL: We MUST use separate fields - columns are ensured to exist above
    if (!hasCategory || !hasTitle) {
      throw new Error('Category and title columns must exist. Please ensure database migration has been run.');
    }
    
    // ALWAYS use separate fields - no fallback to message field format
    const categoryCol = getColumnName('category') || 'category';
    const titleCol = getColumnName('title') || 'title';
    const warrantyTypeCol = getColumnName('warranty_type') || 'warranty_type';
    const appUserIdCol = getColumnName('app_user_id') || 'app_user_id';
    
    insertQuery = `INSERT INTO firereport_firereport (${idCol}, ${fullNameCol}, ${mobileCol}, ${locationCol}, ${messageCol}, ${statusCol}, ${postingDateCol}, ${accountIdCol}, ${categoryCol}, ${titleCol}, ${warrantyTypeCol}, ${assignByCol}, ${appUserIdCol}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING ${idCol}`;
    
    insertParams = [
      nextId,
      fullName,
      mobileNumber,
      location,
      description,
      status,
      postingDate,
      accountId,
      category,
      title,
      warrantyType,
      0,
      appUserId,
    ];
    
    console.log('✅ Saving complaint with separate fields:');
    console.log('   Category → category column:', category);
    console.log('   Title → title column:', title);
    console.log('   Description → message column:', description.substring(0, 50) + '...');
    console.log('   AssignBy → NULL (empty for new complaints)');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📝 Column order in INSERT:');
    console.log(`   1. ${idCol} = $1 (${nextId})`);
    console.log(`   2. ${fullNameCol} = $2 (${fullName})`);
    console.log(`   3. ${mobileCol} = $3 (${mobileNumber})`);
    console.log(`   4. ${locationCol} = $4 (${location})`);
    console.log(`   5. ${messageCol} = $5 (${description.substring(0, 50)}...) - DESCRIPTION ONLY (no [Category] or [Title])`);
    console.log(`   6. ${statusCol} = $6 (${status})`);
    console.log(`   7. ${postingDateCol} = $7 (${postingDate})`);
    console.log(`   8. ${accountIdCol} = $8 (${accountId})`);
    console.log(`   9. ${categoryCol} = $9 (${category}) - CATEGORY FIELD (separate)`);
    console.log(`  10. ${titleCol} = $10 (${title}) - TITLE FIELD (separate)`);
    console.log(`  11. ${warrantyTypeCol} = $11 (${warrantyType})`);
    console.log(`  12. ${assignByCol} = $12 (0 = unassigned)`);
    console.log(`  13. ${appUserIdCol} = $13 (${appUserId})`);
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 Field Mapping Summary:');
    console.log('   Category value → category column ✓ (SEPARATE)');
    console.log('   Title value → title column ✓ (SEPARATE)');
    console.log('   Description value → message column ✓ (ONLY description, no metadata)');
    console.log('   AssignBy → 0 (unassigned) ✓');

    // Validate query before executing
    if (!insertQuery || insertQuery.includes('undefined')) {
      console.error('❌ Invalid query generated:', insertQuery);
      throw new Error('Invalid SQL query - column names may be undefined');
    }
    
    // Validate parameters count matches placeholders
    const placeholderCount = (insertQuery.match(/\$(\d+)/g) || []).length;
    if (placeholderCount !== insertParams.length) {
      console.error('❌ Parameter count mismatch!');
      console.error('Placeholders in query:', placeholderCount);
      console.error('Parameters provided:', insertParams.length);
      console.error('Query:', insertQuery);
      throw new Error(`Parameter count mismatch: ${placeholderCount} placeholders but ${insertParams.length} parameters`);
    }

    try {
      console.log('🔵 Executing insert query...');
      console.log('Query:', insertQuery);
      console.log('Params count:', insertParams.length);
      console.log('Placeholder count:', placeholderCount);
      const insertResult = await pool.query(insertQuery, insertParams);
      insertedId = insertResult.rows[0].id;
      console.log('✅ Complaint inserted successfully with ID:', insertedId);
      
      // Verify the inserted record - check assignby was set correctly
      const verifyResult = await pool.query(
        `SELECT id, account_id, assignby, app_user_id FROM firereport_firereport WHERE id = $1`,
        [insertedId]
      );
      if (verifyResult.rows.length > 0) {
        const record = verifyResult.rows[0];
        console.log('═══════════════════════════════════════════════════════════');
        console.log('🔍 VERIFICATION - Checking inserted record:');
        console.log(`   ID: ${record.id}`);
        console.log(`   account_id: ${record.account_id} (expected: ${accountId})`);
        console.log(`   app_user_id: ${record.app_user_id} (expected: ${appUserId})`);
        console.log(`   assignby: ${record.assignby} (expected: NULL for new complaints)`);
        console.log('═══════════════════════════════════════════════════════════');
        if (record.assignby === null || record.assignby === undefined) {
          console.log('✅ SUCCESS: assignby is NULL (correct for new complaints)');
        } else {
          console.error(`❌ ERROR: assignby should be NULL but is ${record.assignby}`);
          console.error('   New complaints should have assignby = NULL');
        }
        if (record.account_id !== accountId) {
          console.error(`❌ ERROR: account_id (${record.account_id}) != expected (${accountId})`);
        } else {
          console.log('✅ SUCCESS: account_id is set correctly');
        }
        if (appUserId != null && record.app_user_id !== appUserId) {
          console.error(`❌ ERROR: app_user_id (${record.app_user_id}) != expected (${appUserId})`);
        } else if (appUserId != null) {
          console.log('✅ SUCCESS: app_user_id is set correctly');
        }
      }
    } catch (insertError) {
      console.error('❌ Insert error:', insertError);
      console.error('Error message:', insertError.message);
      console.error('Error code:', insertError.code);
      console.error('Error detail:', insertError.detail);
      console.error('Error hint:', insertError.hint);
      console.error('Error position:', insertError.position);
      console.error('Full query:', insertQuery);
      console.error('Query params:', JSON.stringify(insertParams, null, 2));
      console.error('Column names used:', {
        idCol, fullNameCol, mobileCol, locationCol, messageCol,
        statusCol, postingDateCol, accountIdCol, assignByCol
      });
      
      // If insert fails, throw error - no fallback to old format
      // All fields must be saved separately
      throw insertError;
    }

    // Note: Images are not stored in firereport_firereport table
    // If you need to store images, you would need to create a separate table
    // or store image paths in a text field in firereport_firereport
    if (req.files && req.files.length > 0) {
      console.log(`${req.files.length} image(s) uploaded but not stored in firereport_firereport table`);
    }

    res.status(201).json({
      message: 'Complaint created successfully',
      complaint: {
        id: insertedId,
        firereportId: insertedId,
        userId: accountId,
        appUserId: appUserId,
        category: category,
        warrantyType: warrantyType,
        title: title,
        description: description,
        fullName: fullName,
        mobileNumber: mobileNumber,
        location: location,
        status: status,
        postingDate: postingDate,
      },
    });
  } catch (error) {
    console.error('❌ Create complaint error:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint,
      position: error.position,
      stack: error.stack,
    });
    
    // Send detailed error in development, generic in production
    const errorResponse = {
      message: 'Server error while creating complaint',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    };
    
    if (process.env.NODE_ENV === 'development') {
      errorResponse.detail = error.detail;
      errorResponse.hint = error.hint;
      errorResponse.code = error.code;
    }
    
    res.status(500).json(errorResponse);
  }
});

module.exports = router;

