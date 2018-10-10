module.exports = {
  recordsToCreate: 1,
  username: 'admin', // DHIS login username
  password: 'district', // DHIS login password
  fullNamePrefix: 'test-', // prepended to the full name of all TEIs created (and used to target deletion)
  urlBase: 'http://localhost:8080', // URL of the DHIS instance
  apiPathPrefix: '/api/29', // specify the DHIS API version to pin to
  pageSize: 200,
  targetOrgUnits: true, // default all orgUnits, or use ['orgUnitId1', 'orgUnitId2'] to restrict to specific orgUnits
  targetProgram: 'kBqHaz4Y8Sf',
  targetProgramStage: 'vNfIQElUgUM',
  // get these IDs from /api/trackedEntityAttributes.json
  fullNameAttributeId: 'Oe2oAS9TfGA',
  initialsAttributeId: 'hDrhKE59EGO',
  // this ID comes from /api/trackedEntityTypes.json
  personTrackedEntityType: 'kJQnjvFXP18',
  uniqueTextAttributes: [
    'FvpuJ1Ks9nL' // CTC
  ],
  isTrace: false, // true for verbose logging
  parallelTaskCount: 2, // rate limiting so we don't DOS the DHIS instance
  startDataEntryMonthsBack: 10, // number of months to go back (from now) to create data entries; 1 <= value < (infinity, but don't go crazy)
  dataEntryMonthCount: 10 // number of months, from startDataEntryMonthsBack, to create data entries; 1 <= value <= startDataEntryMonthsBack
}
