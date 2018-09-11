const axios = require('axios')
const VError = require('verror')

const urlBase = process.env.DHIS_URLBASE || 'http://dhis.nacopha.techotom.com'
const apiUrl = `${urlBase}/api/29`
const user = process.env.DHIS_USER || 'admin'
const pass = process.env.DHIS_PASS || 'password'
const fullNamePrefix = 'test-'

console.log(`Using config:
  url : ${apiUrl}
  user: ${user}
  pass: ${pass}`)

const authConfig = {
    username: user,
    password: pass,
  }
const getConfig = {
  auth: authConfig
}
const postConfig = {
  headers: {
    'content-type': 'application/json;charset=UTF-8',
  },
  auth: authConfig
}

// trackedEntityAttributes, api/29/trackedEntityAttributes.json
const nacophaId = 'Ek1Ce9w7ua6'
const ctc = 'FvpuJ1Ks9nL'
const fullName = 'Oe2oAS9TfGA'
const gender = 'jeiN3PX6zqu'
const age = 'nWEOJSdLtH3'
const initials = 'hDrhKE59EGO'
const empowermentGroupRole = 'fWlJ0KzmOZs'
const empowermentGroupName = 'uqrWr3oPXRB'

// programs, api/29/programs.json
const programs = {
  ['Sauti Yetu - [Data Collection]']: 'kBqHaz4Y8Sf',
}

// optionSets,  api/29/optionSets.json
// options, api/29/options.json
const genders = {
  male: '1',
  female: '2'
}
const orgUnits = {
  'Arusha CC Konga': 'Ya1xQwpjOBl',
}
const empowermentGroupRoles = {
  group1: '4',
}
const empowermentGroupNames = {
  member: '1',
}

// trackedEntityTypes, api/29/trackedEntityTypes.json
const person = 'kJQnjvFXP18'

const uniqueFragment = new Date().getTime()

// getNacophaId
axios.get(apiUrl + `/trackedEntityAttributes/${nacophaId}/generate`, getConfig)
  .catch(err => {
    console.error(new VError(err, 'Failed to generate a NACOPHA ID'))
    return false
  })
  .then(resp => {
    if (!resp) {
      return false
    }
    const nextNacophaIdValue = resp.data.value
    const fullNameValue = fullNamePrefix + 'Test One'
    // create trackedEntityInstance
    const createTeiData = {
      trackedEntityType: person,
      orgUnit: orgUnits['Arusha CC Konga'],
      attributes: [
        {
          attribute: nacophaId,
          value: nextNacophaIdValue
        }, {
          attribute: ctc,
          value: `${uniqueFragment}`
        }, {
          attribute: fullName,
          value: fullNameValue
        }, {
          attribute: gender,
          value: genders.male
        }, {
          attribute: age,
          value: '2018-09-03'
        }, {
          attribute: initials,
          value: 'tt'
        }, {
          attribute: empowermentGroupRole,
          value: empowermentGroupRoles.group1
        }, {
          attribute: empowermentGroupName,
          value: empowermentGroupNames.member
        }
      ]
    }
    console.log(`Creating a TEI with name '${fullNameValue}'`)
    return axios.post(apiUrl + '/trackedEntityInstances', createTeiData, postConfig)
  })
  .catch(err => {
    //const errData = err && err.response && err.response.data || false
    //if (errData) {
      //console.error('====================')
      //console.error(errData.message)
      //console.error(errData.response.importSummaries[0].conflicts)
      //console.error('====================')
    //}
    console.error(new VError(err, 'Failed to create trackedEntityInstance'))
    return false
  })
  .then(resp => {
    if (!resp) {
      return false
    }
    // enroll trackedEntityInstance
    const enrollTeiData = {
      enrollmentDate: '2018-09-09',
      incidentDate: '2018-09-10',
      orgUnit: orgUnits['Arusha CC Konga'],
      program: programs['Sauti Yetu - [Data Collection]'],
      status: 'ACTIVE',
      trackedEntityInstance: resp.data.response.importSummaries[0].reference
    }
    console.log(`Enrolling TEI`)
    return axios.post(apiUrl + '/enrollments', enrollTeiData, postConfig)
  })
  .catch(err => {
    console.error(new VError(err, 'Failed to enroll a TEI'))
    return false
  })
  .then(resp => {
    if (!resp) {
      return false
    }
    console.log(`Created and enrolled a TEI`)
  })
