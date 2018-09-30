const ctcAttributeId = 'FvpuJ1Ks9nL'

module.exports = {
  recordsToCreate: 1,
  username: 'admin',
  password: 'district',
  fullNamePrefix: 'test-',
  urlBase: 'http://localhost:8080',
  apiPathPrefix: '/api/29',
  pageSize: 200,
  targetOrgUnits: true, // or use ['orgUnitId'] to restrict to specific orgUnits
  targetProgram: 'kBqHaz4Y8Sf',
  // get these IDs from /api/trackedEntityAttributes.json
  fullNameAttributeId: 'Oe2oAS9TfGA',
  initialsAttributeId: 'hDrhKE59EGO',
  ctcAttributeId: ctcAttributeId,
  // this ID comes from /api/trackedEntityTypes.json
  personTrackedEntityType: 'kJQnjvFXP18',
  uniqueTextAttributes: [
    ctcAttributeId,
  ],
  isTrace: false,
  parallelTaskCount: 2,
}
