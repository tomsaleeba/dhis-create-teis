const axios = require('axios')
const VError = require('verror')
const chalk = require('chalk')
const dateGenerator = require('random-date-generator')
const yyyymmdd = require('yyyy-mm-dd')

const urlBase = process.env.DHIS_URLBASE || 'http://dhis.nacopha.techotom.com'
const apiUrl = `${urlBase}/api/29`
const user = process.env.DHIS_USER || 'admin'
const pass = process.env.DHIS_PASS || 'district'
const recordsToCreate = process.env.DHIS_RECORD_COUNT || 1
const fullNamePrefix = 'test-'
const pageSize = 200

let runMode = 'create'
if ('delete'.startsWith(process.argv[2])) {
  runMode = 'delete'
}

console.log(`Using config:
  url : ${apiUrl}
  user: ${user}
  pass: ${pass}
  mode: ${runMode}
  recs: ${recordsToCreate} records will be created (if in create mode)
`)

const authConfig = {
    username: user,
    password: pass,
  }
const getConfig = {
  auth: authConfig
}
const deleteConfig = {
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

const strategies = {
  create: createStrategy,
  delete: deleteStrategy,
}

const strategy = strategies[runMode]
if (!strategy) {
  console.error(`Unsupported runMode = '${runMode}', exiting.`)
  process.exit(1)
}
strategy().catch(err => {
  console.error(chalk.red('[ERROR] '), new VError(err))
})


async function createStrategy () {
  for (let i = 0; i < recordsToCreate; i++) {
    try {
      info(`Creating record ${i+1}/${recordsToCreate}`)
      await createSingleRecord()
    } catch (err) {
      throw new VError(err, 'Failed to execute creating a single record')
    }
  }
}

async function createSingleRecord () {
  const uniqueFragment = new Date().getTime()

  // getNacophaId
  let nextNacophaIdValue
  try {
    const resp = await axios.get(apiUrl + `/trackedEntityAttributes/${nacophaId}/generate`, getConfig)
    nextNacophaIdValue = resp.data.value
  } catch (err) {
    throw new VError(err, 'Failed to generate a NACOPHA ID')
  }
  const nameAndInitials = generateNameAndInitials()
  const fullNameValue = fullNamePrefix + nameAndInitials.name
  const randomGender = Math.random() > 0.5 ? genders.male : genders.female
  const randomDateStr = generateRandomDate()
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
        value: randomGender
      }, {
        attribute: age,
        value: randomDateStr
      }, {
        attribute: initials,
        value: nameAndInitials.initials
      }, {
        attribute: empowermentGroupRole,
        value: empowermentGroupRoles.group1
      }, {
        attribute: empowermentGroupName,
        value: empowermentGroupNames.member
      }
    ]
  }
  info(`Creating a TEI with name='${fullNameValue}', DOB='${randomDateStr}', gender='${randomGender}', nacophaId='${nextNacophaIdValue}'`)
  let teiId
  try {
    const resp = await axios.post(apiUrl + '/trackedEntityInstances', createTeiData, postConfig)
    teiId = resp.data.response.importSummaries[0].reference
  } catch (err) {
    //const errData = err && err.response && err.response.data || false
    //if (errData) {
    //console.error('====================')
    //console.error(errData.message)
    //console.error(errData.response.importSummaries[0].conflicts)
    //console.error('====================')
    //}
    throw new VError(err, 'Failed to create trackedEntityInstance')
  }
  // enroll trackedEntityInstance
  const enrollTeiData = {
    enrollmentDate: '2018-09-09',
    incidentDate: '2018-09-10',
    orgUnit: orgUnits['Arusha CC Konga'],
    program: programs['Sauti Yetu - [Data Collection]'],
    status: 'ACTIVE',
    trackedEntityInstance: teiId
  }
  info(`Enrolling ${fullNameValue}`)
  try {
    await axios.post(apiUrl + '/enrollments', enrollTeiData, postConfig)
  } catch (err) {
    throw new VError(err, `Failed to enroll TEI with ID='${teiId}'`)
  }
  info(`Created and enrolled ${fullNameValue}`)
  return true
}

async function deleteStrategy () {
  info('Gathering TEI IDs to delete')
  const url = apiUrl + `/trackedEntityInstances?ouMode=ALL&filter=${fullName}:LIKE:${fullNamePrefix}&pageSize=${pageSize}`
  axios.get(url, getConfig)
    .then(resp => {
      const teisToDelete = resp.data.trackedEntityInstances.reduce((accum, curr) => {
        accum.push(curr.trackedEntityInstance)
        return accum
      }, [])
      const foundCount = teisToDelete.length
      if (foundCount === 0) {
        info('No TEIs found for deletion, exiting.')
        return false
      }
      info(`Found ${foundCount} TEIs to delete`)
      if (foundCount >= pageSize) {
        info('Found a full page of TEIs to delete, you should run this again in case there are more records than our page size')
      }
      return teisToDelete
    })
    .catch(err => {
      console.error(new VError(err, 'Failed to get list of TEIs to delete'))
      return false
    })
    .then(teisToDelete => {
      if (!teisToDelete) {
        return false
      }
      const deletePromises = teisToDelete.map(curr => axios.delete(apiUrl + `/trackedEntityInstances/${curr}`, deleteConfig))
      info('Starting delete operations')
      return Promise.all(deletePromises)
    })
    .then(results => {
      if (!results) {
        return false
      }
      info(`Successfully deleted ${results.length} TEIs`)
    })
    .catch(err => {
      console.error(new VError(err, 'Failed to delete all TEIs, some may have succeeded though'))
      return false
    })
}

function info (msg) {
  console.log(chalk.yellow('[INFO] ') + msg)
}

// thanks http://listofrandomnames.com/index.cfm?textarea
const firstNames = [
  'Jamison',
  'Sharice',
  'Hermelinda',
  'Lorenzo',
  'Mohamed',
  'Anibal',
  'Collene',
  'Artie',
  'Allena',
  'Byron',
  'Jerrell',
  'Jewell',
  'Caren',
  'Nicholle',
  'Clemencia',
  'Ariana',
  'Deandra',
  'Tegan',
  'Edie',
  'Misti',
  'Clint',
  'Jacob',
  'Shanti',
  'Kami',
  'Clarita',
  'Esther',
  'Hsiu',
  'Cristopher',
  'Kaylee',
  'Loma',
  'Tabatha',
  'Taina',
  'Horace',
  'Edith',
  'Lory',
  'Marlys',
  'Deborah',
  'Evangelina',
  'Lashanda',
  'Marleen',
  'Ward',
  'Leeann',
  'Shira',
  'Ivette',
  'Caryl',
  'Barbra',
  'Rosaria',
  'Daniela',
  'Sharla',
  'Mervin',
]

const surnames = [
  'Huseby',
  'Alcott',
  'Heishman',
  'Westover',
  'Montagna',
  'Elmer',
  'Gerhard',
  'Enderle',
  'Saldana',
  'Mealy',
  'Mund',
  'Followell',
  'Hollis',
  'Tootle',
  'Cowherd',
  'Register',
  'Lenard',
  'Seawood',
  'Straub',
  'Viger',
  'Kan',
  'Clermont',
  'Moree',
  'Stansell',
  'Moneypenny',
  'Caplinger',
  'Poovey',
  'Rushford',
  'Oyer',
  'Kovac',
  'Roll',
  'Pitzer',
  'Creswell',
  'Huss',
  'Gullatt',
  'Stracener',
  'Noel',
  'Hoye',
  'Remington',
  'Burris',
  'Wingham',
  'Steele',
  'Foushee',
  'Veliz',
  'Flickinger',
  'Jiminez',
  'Rodman',
  'Aranda',
  'Brodie',
  'Recinos',
]

function generateNameAndInitials () {
  const firstNameIndex = Math.floor(Math.random() * firstNames.length)
  const surnameIndex = Math.floor(Math.random() * surnames.length)
  const firstNameValue = firstNames[firstNameIndex]
  const surnameValue = surnames[surnameIndex]
  return {
    name: `${firstNameValue} ${surnameValue}`,
    initials: `${firstNameValue.substr(0,1)}${surnameValue.substr(0,1)}`
  }
}

function generateRandomDate () {
  const startDate = new Date(1950, 1, 1)
  const endDate = new Date(2017, 5, 5)
  const r = dateGenerator.getRandomDateInRange(startDate, endDate)
  //return `${r.getFullYear()}-${r.getMonth()}-${r.getDay()}`
  return yyyymmdd(r)
}

