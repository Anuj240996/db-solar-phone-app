function hasNetMeterValue(value) {
  if (value == null) return false;
  const text = String(value).trim();
  if (!text) return false;
  const lower = text.toLowerCase();
  return lower !== 'none' && lower !== 'n/a' && text !== '—' && text !== '-';
}

/**
 * Build net meter sections matching the web admin portal:
 * ABT Meter Details, Cubical Meter Details, Generation With CT Meters.
 */
async function buildNetMeterDetailsForCustomer(pool, customerId) {
  const abtMeters = [];
  const cubicalMeters = [];
  const generationCtMeters = [];

  try {
    const metersQuery = await pool.query(
      `SELECT id, comp_name, make, capacity, serial_no, meter_type,
              transformer_type, transformer_make, transformer_capacity,
              transformer_serial_number
       FROM customer_meters
       WHERE customer_id = $1
       ORDER BY id ASC`,
      [customerId]
    );

    metersQuery.rows.forEach((row, index) => {
      const rowNo = index + 1;
      const hasAbt =
        hasNetMeterValue(row.meter_type) ||
        hasNetMeterValue(row.make) ||
        hasNetMeterValue(row.capacity) ||
        hasNetMeterValue(row.serial_no);

      if (hasAbt) {
        abtMeters.push({
          serialNo: rowNo,
          meterType: row.meter_type || null,
          make: row.make || null,
          capacity: row.capacity || null,
          serialNumber: row.serial_no || null,
        });
      }

      const transformerType = (row.transformer_type || '').trim();
      const isCubical = transformerType.toLowerCase() === 'cubical';
      const hasCubical =
        isCubical &&
        (hasNetMeterValue(row.transformer_make) ||
          hasNetMeterValue(row.transformer_capacity) ||
          hasNetMeterValue(row.transformer_serial_number));

      if (hasCubical) {
        cubicalMeters.push({
          serialNo: rowNo,
          type: transformerType,
          make: row.transformer_make || null,
          capacity: row.transformer_capacity || null,
          serialNumber: row.transformer_serial_number || null,
        });
      }
    });
  } catch (e) {
    console.log('Error fetching customer_meters:', e.message);
  }

  try {
    const genQuery = await pool.query(
      `SELECT id, comp_name, make, serial_no, capacity,
              ct_make, ct_capacity, ct_serial_no
       FROM customer_generationmeter
       WHERE customer_id = $1
       ORDER BY id ASC`,
      [customerId]
    );

    genQuery.rows.forEach((row, index) => {
      generationCtMeters.push({
        serialNo: index + 1,
        genMeterMake: row.make || null,
        genMeterCapacity: row.capacity || null,
        genMeterSerialNumber: row.serial_no || null,
        ctMake: row.ct_make || null,
        ctCapacity: row.ct_capacity || null,
        ctSerialNumber: row.ct_serial_no || null,
      });
    });
  } catch (e) {
    console.log('Error fetching customer_generationmeter:', e.message);
  }

  const firstAbt = abtMeters[0] || null;

  return {
    serialNo: firstAbt?.serialNumber ?? null,
    make: firstAbt?.make ?? null,
    capacity: firstAbt?.capacity ?? null,
    meterType: firstAbt?.meterType ?? null,
    abtMeters,
    cubicalMeters,
    generationCtMeters,
  };
}

module.exports = {
  buildNetMeterDetailsForCustomer,
  hasNetMeterValue,
};
