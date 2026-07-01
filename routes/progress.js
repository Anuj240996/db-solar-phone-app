const express = require('express');
const { authenticate } = require('../middleware/auth');
const pool = require('../database/db');
const { buildNetMeterDetailsForCustomer } = require('../utils/netMeterDetails');

const router = express.Router();

// Helper function to convert bit varying to boolean
function bitToBoolean(bitValue) {
  if (bitValue === null || bitValue === undefined) return false;
  if (typeof bitValue === 'boolean') return bitValue;
  if (typeof bitValue === 'string') {
    // PostgreSQL bit varying returns as string like '1' or '0'
    return bitValue === '1' || bitValue.toLowerCase() === 'true';
  }
  if (typeof bitValue === 'number') return bitValue === 1;
  return false;
}

// Get installation progress from customer_result table
router.get('/', authenticate, async (req, res) => {
  try {
    // Get auth_user.id (integer ID from auth_user table)
    // The relationship is: customer.new_customer_id = auth_user.id
    let authUserId = null;
    
    if (req.user && req.user.auth_user_id) {
      // If auth_user_id is set, use it (this is the integer ID from auth_user table)
      authUserId = req.user.auth_user_id;
      console.log('📋 Using auth_user_id from req.user:', authUserId);
    } else if (req.user && req.user.auth_source === 'auth_user') {
      // Only treat req.user.id as auth_user id if the auth source is auth_user
      if (req.user.id && typeof req.user.id === 'number') {
        authUserId = req.user.id;
        console.log('📋 Using req.user.id as auth_user_id:', authUserId);
      } else if (req.user.id && typeof req.user.id === 'string') {
        const userIdNum = parseInt(req.user.id, 10);
        if (!isNaN(userIdNum) && req.user.id === userIdNum.toString()) {
          authUserId = userIdNum;
          console.log('📋 Parsed req.user.id string to auth_user_id:', authUserId);
        }
      }
    }
    
    if (!authUserId) {
      console.log('⚠️ Could not determine auth_user.id from req.user:', req.user);
      return res.json({ 
        progress: null,
        customer: null,
        message: 'Could not identify user - please contact support' 
      });
    }

    console.log('📋 Fetching progress for auth_user.id:', authUserId);

    // Get customer record by new_customer_id (which relates to auth_user.id)
    // Relationship: customer.new_customer_id = auth_user.id
    const customerResult = await pool.query(
      `SELECT cust_id, consumer, first_name, last_name, middle_name, email, phone, 
              address, city, state, comp_name, new_customer_id
       FROM customer
       WHERE new_customer_id = $1
       LIMIT 1`,
      [authUserId]
    );

    if (customerResult.rows.length === 0) {
      console.log('⚠️ No customer found for new_customer_id:', authUserId);
      return res.json({ 
        progress: null,
        customer: null,
        message: 'No customer record found for this user. Please contact support to link your account.' 
      });
    }

    const customer = customerResult.rows[0];
    console.log('✅ Customer found - cust_id:', customer.cust_id, 'consumer:', customer.consumer, 'new_customer_id:', customer.new_customer_id);

    // Use cust_id to match with customer_result
    // customer_result.consumer_id_id (or consumer_id) references customer.cust_id
    const consumerIdId = customer.cust_id;

    // Get customer_result using consumer_id_id or consumer_id field
    // customer_result.consumer_id (or consumer_id_id) should match customer.cust_id
    let resultQuery;
    
    // First try: match by consumer_id_id (if this field exists)
    try {
      resultQuery = await pool.query(
        `SELECT id, consumer, solar_panel, inverter, net_meter, mseb, 
                solar_pump, inspection_report, controller, consumer_id_id
         FROM customer_result
         WHERE consumer_id_id = $1
         ORDER BY id DESC
         LIMIT 1`,
        [consumerIdId]
      );
      console.log('✅ Query by consumer_id_id returned', resultQuery.rows.length, 'rows');
    } catch (queryError) {
      console.log('⚠️ Query by consumer_id_id failed, trying consumer_id field...');
      // Try consumer_id field instead (based on user's description)
      try {
        resultQuery = await pool.query(
          `SELECT id, consumer, solar_panel, inverter, net_meter, mseb, 
                  solar_pump, inspection_report, controller, consumer_id_id
           FROM customer_result
           WHERE consumer_id = $1
           ORDER BY id DESC
           LIMIT 1`,
          [consumerIdId]
        );
        console.log('✅ Query by consumer_id returned', resultQuery.rows.length, 'rows');
      } catch (altError) {
        console.error('❌ Query by consumer_id also failed:', altError.message);
        resultQuery = { rows: [] };
      }
    }
    
    // If still no result, try matching by consumer text field
    if (resultQuery.rows.length === 0 && customer.consumer) {
      console.log('⚠️ No result found by ID fields, trying consumer text field match...');
      try {
        resultQuery = await pool.query(
          `SELECT id, consumer, solar_panel, inverter, net_meter, mseb, 
                  solar_pump, inspection_report, controller, consumer_id_id
           FROM customer_result
           WHERE consumer = $1
           ORDER BY id DESC
           LIMIT 1`,
          [customer.consumer]
        );
        if (resultQuery.rows.length > 0) {
          console.log('✅ Found result by consumer text field');
        }
      } catch (textError) {
        console.error('❌ Query by consumer text field failed:', textError.message);
      }
    }

    if (resultQuery.rows.length === 0) {
      console.log('⚠️ No customer_result found for consumer_id_id:', consumerIdId);
      return res.json({
        progress: {
          projectStatus: 'Pending',
          solarPanel: { status: 'Pending', completed: false },
          inverter: { status: 'Pending', completed: false },
          netMeter: { status: 'Pending', completed: false },
          mseb: { status: 'Pending', completed: false },
          inspectionReport: { status: 'Pending', completed: false },
        },
        customer: {
          custId: customer.cust_id,
          consumer: customer.consumer,
          name: `${customer.first_name || ''} ${customer.middle_name || ''} ${customer.last_name || ''}`.trim() || customer.comp_name,
          email: customer.email,
          phone: customer.phone?.toString() || '',
          address: customer.address || '',
          city: customer.city || '',
          state: customer.state || '',
        },
      });
    }

    const customerResultData = resultQuery.rows[0];

    // Convert bit varying fields to booleans
    const solarPanel = bitToBoolean(customerResultData.solar_panel);
    const inverter = bitToBoolean(customerResultData.inverter);
    const netMeter = bitToBoolean(customerResultData.net_meter);
    const mseb = bitToBoolean(customerResultData.mseb);
    const inspectionReport = bitToBoolean(customerResultData.inspection_report);
    const solarPump = bitToBoolean(customerResultData.solar_pump);
    const controller = bitToBoolean(customerResultData.controller);

    // Calculate overall project status
    // All required fields (solar_panel, inverter, net_meter, mseb, inspection_report) must be 1
    const allCompleted = solarPanel && inverter && netMeter && mseb && inspectionReport;
    const projectStatus = allCompleted ? 'Completed' : 'Pending';

    // Calculate percentage (5 main fields: solar_panel, inverter, net_meter, mseb, inspection_report)
    const completedCount = [solarPanel, inverter, netMeter, mseb, inspectionReport].filter(Boolean).length;
    const percentage = (completedCount / 5) * 100;

    // Fetch serial numbers/details for each component
    let solarPanelSerial = null;
    let inverterSerial = null;
    let netMeterSerial = null;
    let msebInfo = null;

    // Get Solar Panel serial numbers from barcodeImage
    // Filter by product_name = 'SolarPanel' and assignto_id = auth_user.id
    // Relationship: barcodeimage.assignto_id = auth_user.id (direct relationship, not through customer)
    if (solarPanel) {
      try {
        console.log('🔍 Fetching Solar Panel serial for auth_user.id:', authUserId);
        const solarPanelQuery = await pool.query(
          `SELECT barcode_data, id, product_name, assignto_id
           FROM detect_barcodes_barcodeimage
           WHERE (product_name ILIKE '%SolarPanel%' OR product_name ILIKE '%Solar Panel%')
             AND assignto_id = $1
           ORDER BY id DESC
       LIMIT 1`,
          [authUserId]
        );
        
        console.log(`✅ Found ${solarPanelQuery.rows.length} Solar Panel record(s) for auth_user.id ${authUserId}`);
        
        if (solarPanelQuery.rows.length > 0 && solarPanelQuery.rows[0].barcode_data) {
          solarPanelSerial = solarPanelQuery.rows[0].barcode_data;
          console.log('✅ Solar Panel serial number:', solarPanelSerial);
        } else {
          console.log('⚠️ No Solar Panel barcode_data found for this user');
        }
      } catch (e) {
        console.error('❌ Error fetching solar panel serial:', e.message);
        console.error('   Stack:', e.stack);
      }
    }

    // Get Inverter serial numbers from barcodeImage
    // Filter by product_name = 'Inverter' and assignto_id = auth_user.id
    // Relationship: barcodeimage.assignto_id = auth_user.id (direct relationship, not through customer)
    if (inverter) {
      try {
        console.log('🔍 Fetching Inverter serial for auth_user.id:', authUserId);
        const inverterQuery = await pool.query(
          `SELECT barcode_data, id, product_name, assignto_id
           FROM detect_barcodes_barcodeimage
           WHERE product_name ILIKE '%Inverter%'
             AND assignto_id = $1
           ORDER BY id DESC
           LIMIT 1`,
          [authUserId]
        );
        
        console.log(`✅ Found ${inverterQuery.rows.length} Inverter record(s) for auth_user.id ${authUserId}`);
        
        if (inverterQuery.rows.length > 0 && inverterQuery.rows[0].barcode_data) {
          inverterSerial = inverterQuery.rows[0].barcode_data;
          console.log('✅ Inverter serial number:', inverterSerial);
        } else {
          console.log('⚠️ No Inverter barcode_data found for this user');
        }
      } catch (e) {
        console.error('❌ Error fetching inverter serial:', e.message);
        console.error('   Stack:', e.stack);
      }
    }

    // Net meter tables: ABT, Cubical, Generation With CT (same as web portal).
    let netMeterDetails = null;
    try {
      netMeterDetails = await buildNetMeterDetailsForCustomer(pool, customer.cust_id);
      netMeterSerial = netMeterDetails?.serialNo || null;
      if (netMeterDetails) {
        console.log('✅ Net Meter details found for customer_id:', customer.cust_id);
      }
    } catch (e) {
      console.error('❌ Error fetching net meter details:', e.message);
    }

    // Get MSEB information — load whenever a row exists (not only when mseb flag is 1)
    try {
        console.log('🔍 Fetching MSEB details for customer_id:', customer.cust_id);
        let msebData = null;
        const msebByCust = await pool.query(
          `SELECT id, comp_name, load_extension, flisibility, quotation, 
                  sent_to_bill, net_meter, flexibility, approval, 
                  meter_testing, agreement, release, installation_date,
                  flisibility_date, quotation_date, sent_to_bill_date,
                  net_meter_date, flexibility_date, approval_date,
                  meter_testing_date, agreement_date, release_date,
                  installation_date_date, load_extension_date, created_at, customer_id
           FROM customer_mseb
           WHERE customer_id = $1
           ORDER BY id DESC
           LIMIT 1`,
          [customer.cust_id]
        );
        if (msebByCust.rows.length > 0) {
          msebData = msebByCust.rows[0];
        } else if ((customer.comp_name || '').trim()) {
          const msebByName = await pool.query(
            `SELECT id, comp_name, load_extension, flisibility, quotation, 
                    sent_to_bill, net_meter, flexibility, approval, 
                    meter_testing, agreement, release, installation_date,
                    flisibility_date, quotation_date, sent_to_bill_date,
                    net_meter_date, flexibility_date, approval_date,
                    meter_testing_date, agreement_date, release_date,
                    installation_date_date, load_extension_date, created_at, customer_id
             FROM customer_mseb
             WHERE TRIM(LOWER(COALESCE(comp_name,''))) = TRIM(LOWER($1))
             ORDER BY id DESC
             LIMIT 1`,
            [customer.comp_name.trim()]
          );
          if (msebByName.rows.length > 0) {
            msebData = msebByName.rows[0];
            console.log(
              `ℹ️ MSEB linked by comp_name for cust_id ${customer.cust_id} → customer_mseb.customer_id ${msebData.customer_id}`
            );
          }
        }
        
        if (msebData) {
          
          // Convert all boolean fields
          const loadExtension = bitToBoolean(msebData.load_extension);
          const flisibility = bitToBoolean(msebData.flisibility);
          const quotation = bitToBoolean(msebData.quotation);
          const sentToBill = bitToBoolean(msebData.sent_to_bill);
          const netMeterField = bitToBoolean(msebData.net_meter);
          const flexibility = bitToBoolean(msebData.flexibility);
          const approval = bitToBoolean(msebData.approval);
          const meterTesting = bitToBoolean(msebData.meter_testing);
          const agreement = bitToBoolean(msebData.agreement);
          const release = bitToBoolean(msebData.release);
          const installationDate = bitToBoolean(msebData.installation_date);
          
          // Calculate MSEB progress (out of 11 steps)
          const msebSteps = [
            loadExtension, flisibility, quotation, sentToBill, netMeterField,
            flexibility, approval, meterTesting, agreement, release, installationDate
          ];
          const completedSteps = msebSteps.filter(Boolean).length;
          const msebProgress = (completedSteps / 11) * 100;
          
          msebInfo = {
            id: msebData.id,
            compName: msebData.comp_name,
            progress: msebProgress.toFixed(1),
            completedSteps: completedSteps,
            totalSteps: 11,
            steps: {
              loadExtension: {
                completed: loadExtension,
                date: msebData.load_extension_date || null,
              },
              flisibility: {
                completed: flisibility,
                date: msebData.flisibility_date || null,
              },
              quotation: {
                completed: quotation,
                date: msebData.quotation_date || null,
              },
              sentToBill: {
                completed: sentToBill,
                date: msebData.sent_to_bill_date || null,
              },
              netMeter: {
                completed: netMeterField,
                date: msebData.net_meter_date || null,
              },
              flexibility: {
                completed: flexibility,
                date: msebData.flexibility_date || null,
              },
              approval: {
                completed: approval,
                date: msebData.approval_date || null,
              },
              meterTesting: {
                completed: meterTesting,
                date: msebData.meter_testing_date || null,
              },
              agreement: {
                completed: agreement,
                date: msebData.agreement_date || null,
              },
              release: {
                completed: release,
                date: msebData.release_date || null,
              },
              installation: {
                completed: installationDate,
                date: msebData.installation_date_date || null,
              },
            },
            createdAt: msebData.created_at || null,
          };
          
          console.log(`✅ MSEB details found - Progress: ${msebProgress.toFixed(1)}% (${completedSteps}/11 steps completed)`);
        } else {
          console.log('⚠️ No MSEB record found for customer_id:', customer.cust_id);
        }
    } catch (e) {
      console.error('❌ Error fetching MSEB info:', e.message);
      console.error('   Stack:', e.stack);
    }

    res.json({
      progress: {
        projectStatus,
        percentage: percentage.toFixed(1),
        solarPanel: {
          status: solarPanel ? 'Completed' : 'Pending',
          completed: solarPanel,
          serialNo: solarPanelSerial,
        },
        inverter: {
          status: inverter ? 'Completed' : 'Pending',
          completed: inverter,
          serialNo: inverterSerial,
        },
        netMeter: {
          status: netMeter ? 'Completed' : 'Pending',
          completed: netMeter,
          serialNo: netMeterSerial,
          details: netMeterDetails,
        },
        mseb: {
          status: mseb ? 'Completed' : (msebInfo ? 'In Progress' : 'Pending'),
          completed: mseb,
          progress: msebInfo?.progress || '0.0',
          completedSteps: msebInfo?.completedSteps || 0,
          totalSteps: msebInfo?.totalSteps || 11,
          details: msebInfo
            ? {
                progress: msebInfo.progress,
                completedSteps: msebInfo.completedSteps,
                totalSteps: msebInfo.totalSteps,
                steps: msebInfo.steps,
                compName: msebInfo.compName,
              }
            : null,
        },
        inspectionReport: {
          status: inspectionReport ? 'Completed' : 'Pending',
          completed: inspectionReport,
        },
        solarPump: {
          status: solarPump ? 'Completed' : 'Pending',
          completed: solarPump,
        },
        controller: {
          status: controller ? 'Completed' : 'Pending',
          completed: controller,
        },
        consumerIdId: consumerIdId,
      },
      customer: {
        custId: customer.cust_id,
        consumer: customer.consumer,
        name: `${customer.first_name || ''} ${customer.middle_name || ''} ${customer.last_name || ''}`.trim() || customer.comp_name,
        email: customer.email,
        phone: customer.phone?.toString() || '',
        address: customer.address || '',
        city: customer.city || '',
        state: customer.state || '',
      },
    });
  } catch (error) {
    console.error('Get progress error:', error);
    res.status(500).json({ message: 'Server error', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Get barcode images for a specific product (Solar Panel or Inverter) for the customer
router.get('/barcode-images/:productType', authenticate, async (req, res) => {
  try {
    // Disable caching for barcode images responses to avoid 304 Not Modified
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    // Express automatically decodes URL parameters, so productType will be decoded
    let { productType } = req.params; // 'Solar Panel' or 'Inverter'
    // Decode in case of double encoding
    try {
      productType = decodeURIComponent(productType);
    } catch (e) {
      // If already decoded, continue
    }
    // Determine auth_user.id to use for barcode lookups.
    // If the frontend provided a projectId (query param), prefer that project's owner (customer.new_customer_id).
    let authUserId = null;
    const projectIdFromQuery = req.query.projectId ?? req.query.custId ?? null;
    if (projectIdFromQuery) {
      try {
        const custRes = await pool.query(
          `SELECT new_customer_id FROM customer WHERE cust_id = $1 LIMIT 1`,
          [projectIdFromQuery]
        );
        if (custRes.rows.length > 0 && custRes.rows[0].new_customer_id) {
          authUserId = custRes.rows[0].new_customer_id;
          console.log('📋 Using new_customer_id from customer for projectId:', projectIdFromQuery, authUserId);
        } else {
          console.log('⚠️ No new_customer_id found for projectId:', projectIdFromQuery);
        }
      } catch (e) {
        console.warn('⚠️ Error fetching customer for projectId:', projectIdFromQuery, e.message);
      }
    }

    // Fallback to token-derived auth_user id
    if (!authUserId) {
      if (req.user.auth_user_id) {
        authUserId = req.user.auth_user_id;
      } else if (req.user.id && typeof req.user.id === 'number') {
        authUserId = req.user.id;
      } else if (req.user.id && typeof req.user.id === 'string') {
        const userIdNum = parseInt(req.user.id, 10);
        if (!isNaN(userIdNum) && req.user.id === userIdNum.toString()) {
          authUserId = userIdNum;
        }
      }
    }

    if (!authUserId) {
      console.log('⚠️ Could not determine auth_user.id for barcode images');
      return res.status(404).json({ message: 'User not found' });
    }

    console.log('📷 Fetching barcode images for product type:', productType, 'for auth_user.id:', authUserId);

    // Get customer record by new_customer_id (which relates to auth_user.id)
    // Relationship: customer.new_customer_id = auth_user.id
    const customerResult = await pool.query(
      `SELECT cust_id, consumer
       FROM customer
       WHERE new_customer_id = $1
       LIMIT 1`,
      [authUserId]
    );

    if (customerResult.rows.length === 0) {
      console.log('⚠️ No customer found for new_customer_id:', authUserId);
      return res.status(404).json({ message: 'Customer not found' });
    }

    const customer = customerResult.rows[0];
    // Use cust_id to match with customer_result
    const consumerIdId = customer.cust_id;
    const consumer = customer.consumer;

    console.log('📋 Customer info - cust_id:', customer.cust_id, 'consumer:', consumer);

    // Get barcode images from detect_barcodes_barcodeimage table
    // Filter by product_name and assignto_id = auth_user.id
    // Relationship: barcodeimage.assignto_id = auth_user.id (direct relationship)
    // For Solar Panel: product_name should contain 'SolarPanel' or 'Solar Panel'
    // For Inverter: product_name should contain 'Inverter'
    
    let barcodeQuery;
    const productTypeLower = productType.toLowerCase();
    
    if (productTypeLower.includes('solar')) {
      // Match both 'SolarPanel' and 'Solar Panel' for Solar Panel products
      barcodeQuery = await pool.query(
        `SELECT bi.id, bi.barcode_data, bi.file_saved_at, bi.image, bi.barcode_type, 
                bi.company, bi.wattage, bi.barcode_path, bi.company_name, 
                bi.product_name, bi.stock_id, bi.assignto_id, bi.assignby,
                inv_stock.name as solar_type
         FROM detect_barcodes_barcodeimage bi
         LEFT JOIN transactions_purchaseserial tps ON tps.stock_id = bi.stock_id
         LEFT JOIN inventory_stock inv_stock ON inv_stock.id = tps.stock_id
         WHERE (bi.product_name ILIKE $1 OR bi.product_name ILIKE $2)
           AND bi.assignto_id = $3
         ORDER BY bi.file_saved_at DESC`,
        ['%SolarPanel%', '%Solar Panel%', authUserId]
      );
    } else if (productTypeLower.includes('inverter')) {
      // Filter for Inverter products
      barcodeQuery = await pool.query(
        `SELECT id, barcode_data, file_saved_at, image, barcode_type, 
                company, wattage, barcode_path, company_name, 
                product_name, stock_id, assignto_id, assignby
         FROM detect_barcodes_barcodeimage
         WHERE product_name ILIKE $1
           AND assignto_id = $2
         ORDER BY file_saved_at DESC`,
        ['%Inverter%', authUserId]
      );
    } else {
      // Fallback for other product types
      barcodeQuery = await pool.query(
        `SELECT id, barcode_data, file_saved_at, image, barcode_type, 
                company, wattage, barcode_path, company_name, 
                product_name, stock_id, assignto_id, assignby
         FROM detect_barcodes_barcodeimage
         WHERE product_name ILIKE $1
           AND assignto_id = $2
         ORDER BY file_saved_at DESC`,
        [`%${productType}%`, authUserId]
      );
    }

    console.log(`✅ Found ${barcodeQuery.rows.length} barcode images for product type: ${productType} and auth_user.id: ${authUserId}`);

    // Get customer warranty years and MSEB installation date
    let solWarrantyYears = null;
    let invWarrantyYears = null;
    let installationDateFromMseb = null;
    
    try {
      const customerResult = await pool.query(
        `SELECT cust_id FROM customer WHERE new_customer_id = $1 LIMIT 1`,
        [authUserId]
      );
      if (customerResult.rows.length > 0) {
        const custId = customerResult.rows[0].cust_id;
        
        const customerWarrantyQuery = await pool.query(
          `SELECT sol_warranty, inv_warranty
           FROM customer
           WHERE cust_id = $1
           LIMIT 1`,
          [custId]
        );
        if (customerWarrantyQuery.rows.length > 0) {
          solWarrantyYears = customerWarrantyQuery.rows[0].sol_warranty;
          invWarrantyYears = customerWarrantyQuery.rows[0].inv_warranty;
        }
        
        // Get installation_date_date from customer_mseb table
        const msebDateQuery = await pool.query(
          `SELECT installation_date_date
           FROM customer_mseb
           WHERE customer_id = $1
           ORDER BY id DESC
           LIMIT 1`,
          [custId]
        );
        if (msebDateQuery.rows.length > 0 && msebDateQuery.rows[0].installation_date_date) {
          installationDateFromMseb = msebDateQuery.rows[0].installation_date_date;
        }
      }
    } catch (e) {
      console.log('Error fetching warranty years and MSEB date:', e.message);
    }

    // Calculate warranty dates using MSEB installation_date_date
    const now = new Date();
    const installationDate = installationDateFromMseb ? new Date(installationDateFromMseb) : now;
    const isSolarPanel = productTypeLower.includes('solar');
    const warrantyYears = isSolarPanel ? (solWarrantyYears || 25) : (invWarrantyYears || 25);
    const warrantyStart = installationDate.toISOString().split('T')[0];
    const warrantyEndDate = new Date(installationDate);
    warrantyEndDate.setFullYear(warrantyEndDate.getFullYear() + parseInt(warrantyYears));
    const warrantyEnd = warrantyEndDate.toISOString().split('T')[0];

    res.json({
      productType,
      images: barcodeQuery.rows.map(row => {
        return {
          id: row.id,
          productId: row.barcode_data || `PROD-${row.id}`,
          barcodeData: row.barcode_data,
          fileSavedAt: row.file_saved_at,
          image: row.image,
          barcodeType: row.barcode_type,
          brand: row.company_name || row.company || null,
          company: row.company_name || row.company || null,
          companyName: row.company_name || row.company || null,
          solarType: row.solar_type || null,
          wattage: row.wattage ? `${row.wattage} Wp` : row.wattage?.toString() || '',
          barcodePath: row.barcode_path,
          productName: row.product_name,
          model: row.product_name || 'Unknown Model',
          stockId: row.stock_id,
          assigntoId: row.assignto_id,
          assignby: row.assignby,
          warrantyStart: warrantyStart,
          warrantyEnd: warrantyEnd,
          warranty: `${warrantyYears} year`,
          price: null,
          tax: null,
          taxPercent: 18,
        };
      }),
    });
  } catch (error) {
    console.error('Get barcode images error:', error);
    res.status(500).json({ message: 'Server error', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// Get progress history (kept for backward compatibility, but may not be used)
router.get('/history', authenticate, async (req, res) => {
  try {
    // For now, return empty history since we're using customer_result instead
    res.json({ history: [] });
  } catch (error) {
    console.error('Get progress history error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

