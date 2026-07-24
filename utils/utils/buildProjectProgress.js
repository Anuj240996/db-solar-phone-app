const { bitToBoolean } = require('./customerResult');

/**
 * Build progress payload when customer_result row is missing or progress assembly failed.
 */
function buildProgressFallback({
  customer,
  products = [],
  customerResultData = null,
  netMeterDetails = null,
  msebDetails = null,
  netMeterUsed = 0,
}) {
  const resultRow = customerResultData;
  const solarPanel = resultRow ? bitToBoolean(resultRow.solar_panel) : products.some((p) =>
    String(p.productType || p.model || '').toLowerCase().includes('solar')
  );
  const inverter = resultRow ? bitToBoolean(resultRow.inverter) : products.some((p) =>
    String(p.productType || p.model || '').toLowerCase().includes('inverter')
  );
  const netMeter = resultRow ? bitToBoolean(resultRow.net_meter) : false;
  const mseb = resultRow ? bitToBoolean(resultRow.mseb) : Boolean(msebDetails);
  const inspectionReport = resultRow ? bitToBoolean(resultRow.inspection_report) : false;

  const solarProducts = products.filter((p) =>
    String(p.productType || p.model || '').toLowerCase().includes('solar')
  );
  const inverterProducts = products.filter((p) =>
    String(p.productType || p.model || '').toLowerCase().includes('inverter')
  );

  const firstSerial = (list) => {
    for (const p of list) {
      const id = p.productId || p.barcode_data;
      if (id) return String(id);
    }
    return null;
  };

  const completedCount = [solarPanel, inverter, netMeter, mseb, inspectionReport].filter(Boolean).length;

  return {
    projectStatus: completedCount === 5 || inspectionReport ? 'Completed' : 'Pending',
    percentage: ((completedCount / 5) * 100).toFixed(1),
    solarPanel: {
      status: solarPanel ? 'Completed' : 'Pending',
      completed: solarPanel,
      serialNo: firstSerial(solarProducts),
      companyName: solarProducts[0]?.brand || solarProducts[0]?.companyName || customer?.solar_comp || null,
      quantity: solarProducts.length || customer?.qunt_solar || 0,
      wattage: solarProducts[0]?.wattage || null,
    },
    inverter: {
      status: inverter ? 'Completed' : 'Pending',
      completed: inverter,
      serialNo: firstSerial(inverterProducts),
      companyName: inverterProducts[0]?.brand || inverterProducts[0]?.companyName || customer?.upsc || null,
      quantity: inverterProducts.length || customer?.qunt_inv || 0,
      wattage: inverterProducts[0]?.wattage || null,
    },
    netMeter: {
      status: netMeter ? 'Completed' : 'Pending',
      completed: netMeter,
      serialNo: netMeterDetails?.serialNo || null,
      quantity: netMeterUsed || 0,
      details: netMeterDetails || null,
    },
    mseb: {
      status: mseb ? 'Completed' : msebDetails ? 'In Progress' : 'Pending',
      completed: mseb,
      details: msebDetails || null,
    },
    inspectionReport: {
      status: inspectionReport ? 'Completed' : 'Pending',
      completed: inspectionReport,
    },
  };
}

module.exports = { buildProgressFallback };
