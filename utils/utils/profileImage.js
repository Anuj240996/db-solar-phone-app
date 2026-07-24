/**
 * Normalize Django user_profile.image paths for API clients.
 * DB values are typically "profile_pics/name.jpg" or "profile_images/default.png".
 */
function normalizeProfileImage(raw, publicBaseUrl) {
  if (!raw || !String(raw).trim()) {
    return { imagePath: '', imageUrl: '' };
  }

  const trimmed = String(raw).trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return { imagePath: trimmed, imageUrl: trimmed };
  }

  let rel = trimmed.replace(/^\/+/, '');
  if (!rel.startsWith('media/')) {
    rel = `media/${rel}`;
  }

  const mediaBase = (process.env.MEDIA_BASE_URL || '').replace(/\/+$/, '');
  const port = process.env.PORT || 3000;
  const apiRoot = (publicBaseUrl || process.env.API_PUBLIC_URL || `http://localhost:${port}`)
    .replace(/\/api\/?$/, '')
    .replace(/\/+$/, '');

  let imageUrl;
  if (mediaBase) {
    const withoutMedia = rel.replace(/^media\//, '');
    imageUrl = mediaBase.endsWith('/media')
      ? `${mediaBase}/${withoutMedia}`
      : `${mediaBase}/media/${withoutMedia}`;
  } else {
    imageUrl = `${apiRoot}/${rel}`;
  }

  return { imagePath: rel, imageUrl };
}

function buildEngineerFromRow(row, assignToId, getValue, publicBaseUrl) {
  if (!assignToId) return null;

  const engineerFirstName = getValue(row, 'engineer_first_name') || '';
  const engineerLastName = getValue(row, 'engineer_last_name') || '';
  const engineerEmail = getValue(row, 'engineer_email') || '';
  const engineerUsername = getValue(row, 'engineer_username') || '';
  const engineerProfileName = getValue(row, 'engineer_profile_name') || '';
  const engineerContactNumber = getValue(row, 'engineer_contact_number') || '';
  const engineerAddress = getValue(row, 'engineer_address') || '';
  const engineerDesignation = getValue(row, 'engineer_designation') || '';
  const engineerImage = getValue(row, 'engineer_image') || '';
  const { imagePath, imageUrl } = normalizeProfileImage(engineerImage, publicBaseUrl);

  const hasIdentity =
    engineerFirstName ||
    engineerLastName ||
    engineerEmail ||
    engineerUsername ||
    engineerProfileName;
  const hasProfile = engineerImage || engineerDesignation || engineerContactNumber;

  if (!hasIdentity && !hasProfile) return null;

  const fullName =
    `${engineerFirstName} ${engineerLastName}`.trim() ||
    engineerProfileName ||
    engineerUsername ||
    engineerEmail ||
    `Engineer #${assignToId}`;

  return {
    id: assignToId,
    firstName: engineerFirstName,
    lastName: engineerLastName,
    fullName,
    email: engineerEmail,
    employeeId: assignToId.toString(),
    designation: engineerDesignation || '',
    contactNumber: engineerContactNumber || '',
    address: engineerAddress || '',
    imagePath: imagePath || '',
    imageUrl: imageUrl || '',
  };
}

module.exports = { normalizeProfileImage, buildEngineerFromRow };
