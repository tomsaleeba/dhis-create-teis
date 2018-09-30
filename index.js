const axios = require('axios')
const VError = require('verror')
const chalk = require('chalk')
const dateGenerator = require('random-date-generator')
const yyyymmdd = require('yyyy-mm-dd')
const shortid = require('shortid')

const defaultConfig = require('./default-config')

let userConfig
try {
  userConfig = require('./config.js')
} catch (err) {
  console.error(chalk.yellow('[WARN] '), 'No user config (./config.js) found ' +
    'or error during loading, using all defaults')
  userConfig = {}
}
const config = Object.assign(defaultConfig, userConfig)

const apiUrl = `${config.urlBase}${config.apiPathPrefix}`

let runMode = 'create'
if ('delete'.startsWith(process.argv[2])) {
  runMode = 'delete'
}

let recCountFragment = ''
if (runMode === 'create') {
  recCountFragment = `recs: ${config.recordsToCreate} records will be created\n`
}
console.log(`Using config:
  url : ${apiUrl}
  user: ${config.username}
  pass: ${config.password}
  mode: ${runMode}
  ${recCountFragment}`)

const authConfig = {
  auth: {
    username: config.username,
    password: config.password
  }
}
function httpConfig (extra) {
  if (!extra) {
    return authConfig
  }
  return Object.assign(authConfig, extra)
}

let targetOrgUnits = config.targetOrgUnits
if (targetOrgUnits === true) {
  // FIXME build orgUnit tree and find all level 5 (empowerment groups) to populate
  // set targetOrgUnits = [] list of looked up IDs
  throw new Error(chalk.red('[ERROR] '), 'using all orgUnits is not yet implemented')
}

const strategies = {
  create: createStrategy,
  delete: deleteStrategy
}

const strategy = strategies[runMode]
if (!strategy) {
  console.error(`Unsupported runMode = '${runMode}', exiting.`)
  process.exit(1)
}
strategy().catch(err => {
  console.error(chalk.red('[ERROR] '), new VError(err))
})



function getOrgUnit () {
  const index = Math.floor(Math.random() * targetOrgUnits.length)
  return targetOrgUnits[index]
}

async function getTrackedEntityAttributes () {
  let attributeIdsInProgram
  try {
    const resp = await axios.get(apiUrl + `/programs/${config.targetProgram}`, httpConfig({
      params: {
        paging: false,
        fields: `programTrackedEntityAttributes[trackedEntityAttribute]`
      }
    }))
    attributeIdsInProgram = resp.data.programTrackedEntityAttributes.map(e => e.trackedEntityAttribute.id)
  } catch (err) {
    throw chainedError(err, `Failed to get list of tracked entity attributes in the program='${config.targetProgram}'`)
	logAxiosError(err)
  }
  try {
    const idFilter = attributeIdsInProgram.join(',')
    const resp = await axios.get(apiUrl + '/trackedEntityAttributes', httpConfig({
      params: {
        paging: false,
        filter: `id:in:[${idFilter}]`,
        fields: `
          id,
          displayName,
          valueType,
          generated,
          optionSet[
            id,
            options[
              code,
              displayName
            ]
          ]`.replace(/\s/g, '')
      }
    }))
    const result = resp.data.trackedEntityAttributes.reduce((accum, curr) => {
      const key = curr.id
      const def = {
        id: curr.id,
        type: curr.valueType,
        displayName: curr.displayName,
        generated: curr.generated
      }
      if (curr.optionSet && curr.optionSet.options) {
        def.values = curr.optionSet.options.map(e => e.code)
      }
      accum[key] = def
      return accum
    }, {})
    return result
  } catch (err) {
  	logAxiosError(err)
    throw chainedError(err, 'Failed to get tracked entity attributes')
  }
}

async function generateContext () {
  const teas = await getTrackedEntityAttributes()
  const teaStrategies = {
    TEXT: async def => {
      if (def.generated) {
        try {
          const resp = await axios.get(apiUrl + `/trackedEntityAttributes/${def.id}/generate`, authConfig)
          return resp.data.value
        } catch (err) {
          throw new VError(err, `Failed to generate a '${def.displayName}' value`)
        }
      }
      if (def.id === config.fullNameAttributeId) {
        return config.fullNamePrefix + generateName()
      }
      if (def.id === config.initialsAttributeId) {
        return 'AA' // too hard to synchronise with fullName
      }
      if (def.values) {
        const index = Math.floor(Math.random() * def.values.length)
        return def.values[index]
      }
      const mustBeUnique = config.uniqueTextAttributes.find(e => e === def.id)
      if (mustBeUnique) {
        return generateCTC() // FIXME - right now we assume the first element in config is CTC - that might change.
      }
      return 'default value'
    },
    ORGANISATION_UNIT: def => {
      return def.orgUnit // asuming we need to be consistent and use the same orgUnit throughout for a single TEI
    },
    BOOLEAN: def => {
      return Math.random() > 0.5
    },
    PHONE_NUMBER: def => {
      return '1234567890'
    },
    AGE: def => { // it's actually date of birth, not age
      return generateRandomDate()
    },
    DATE: def => {
      return generateRandomDate()
    }
  }
  return {
    trackedEntityAttributes: {
      vocab: teas,
      strategies: teaStrategies
    }
  }
}

async function createStrategy () {
  const context = await generateContext()
  try {
    const promises = []
    for (let i = 0; i < config.recordsToCreate; i++) {
      const p = createSingleRecord(context, i)
      promises.push(p)
    }
    await Promise.all(promises)
      //.catch(err => {
        //console.log(chalk.red('[RUN FAILED]'), `At least one record failed but other may have succeeded`, err)
      //})
  } catch (err) {
    throw new VError(err, `At least one record failed but other may have succeeded`)
  }
}

async function buildTeiAttributes (context, orgUnit) {
  const teaIds = Object.keys(context.trackedEntityAttributes.vocab)
  const result = []
  for (let currKey of teaIds) {
    const curr = context.trackedEntityAttributes.vocab[currKey]
    const currType = curr.type
    const strategy = context.trackedEntityAttributes.strategies[currType]
    if (!strategy) {
      throw new Error(`Failed while trying to create an attribute of type='${currType}'; cannot find suitable strategy`)
    }
    curr.orgUnit = orgUnit
    const value = await strategy(curr)
    result.push({
      attribute: currKey,
      value: value
    })
  }
  return result
}

async function createSingleRecord (context, index) {
  info(`Creating record ${index + 1}/${config.recordsToCreate}`)
  const orgUnit = getOrgUnit()
  let teiAttributes
  try {
    teiAttributes = await buildTeiAttributes(context, orgUnit)
  } catch (err) {
    throw new VError(err, 'Failed while trying to build tracked entity attributes')
  }
  const createTeiData = {
    trackedEntityType: config.personTrackedEntityType,
    orgUnit: orgUnit,
    attributes: teiAttributes
  }
  if (config.isTrace) {
    dumpTeiToConsole(createTeiData, context)
  }
  info(`Creating a TEI`)
  let teiId
  try {
    const resp = await axios.post(apiUrl + '/trackedEntityInstances', createTeiData, authConfig)
    teiId = resp.data.response.importSummaries[0].reference
  } catch (err) {
    logAxiosError(err)
    throw new VError(err, `Failed to create a trackedEntityInstance`)
  }
  // enroll trackedEntityInstance
  const someDate = generateRandomDate()
  const enrollTeiData = {
    enrollmentDate: someDate,
    incidentDate: someDate,
    orgUnit: orgUnit,
    program: config.targetProgram,
    status: 'ACTIVE',
    trackedEntityInstance: teiId
  }
  info(`Enrolling TEI ${teiId}`)
  try {
    await axios.post(apiUrl + '/enrollments', enrollTeiData, authConfig)
  } catch (err) {
    throw new VError(err, `Failed to enroll TEI with ID='${teiId}'`)
  }
  info(`Created and enrolled ${teiId}`)
  return true
}

function logAxiosError (err) {
  const errData = err && err.response && err.response.data || false
  if (!errData) {
    return
  }
  console.error('====================')
  console.error(errData.message)
  console.error(errData.response.importSummaries[0].conflicts)
  console.error('====================')
}

async function deleteStrategy () {
  info('Gathering TEI IDs to delete')
  let teisToDelete
  try {
    const orgUnitIdList = targetOrgUnits.join(';')
    const resp = await axios.get(apiUrl + `/trackedEntityInstances`, httpConfig({
      params: {
        filter: `${config.fullNameAttributeId}:LIKE:${config.fullNamePrefix}`,
        ou: orgUnitIdList,
        pageSize: config.pageSize
      }
    }))
    teisToDelete = resp.data.trackedEntityInstances.map(e => e.trackedEntityInstance)
    const foundCount = teisToDelete.length
    if (foundCount === 0) {
      info('No TEIs found for deletion, exiting.')
      return
    }
    info(`Found ${foundCount} TEIs to delete`)
    if (foundCount >= config.pageSize) {
      info('Found a full page of TEIs to delete, you should run this again in case there are more records than our page size')
    }
  } catch (err) {
    throw new VError(err, 'Failed to get list of TEIs to delete')
  }
  const deletePromises = teisToDelete.map(curr => axios.delete(apiUrl + `/trackedEntityInstances/${curr}`, authConfig))
  info('Starting delete operations')
  try {
    await Promise.all(deletePromises)
    info(`Successfully deleted ${deletePromises.length} TEIs`)
  } catch (err) {
    throw new VError(err, 'Failed to delete all TEIs, some may have succeeded though')
  }
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
  'Mervin'
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
  'Recinos'
]

function padToFour(number) {
  if (number<=9999) { number = ("000"+number).slice(-4); }
  return number;
}

function padToTwo(number) {
  if (number<=99) { number = ("0"+number).slice(-2); }
  return number;
}

function generateCTC () {
  const region = padToTwo(Math.floor(Math.random() * 10))
  const district = padToTwo(Math.floor(Math.random() * 10))
  const ctcId = padToFour(Math.floor(Math.random() * 1000))
  const clientId = padToFour(Math.floor(Math.random() * 1000))
  return `${region}-${district}-${ctcId}-${clientId}`
}

function generateName () {
  const firstNameIndex = Math.floor(Math.random() * firstNames.length)
  const surnameIndex = Math.floor(Math.random() * surnames.length)
  const firstNameValue = firstNames[firstNameIndex]
  const surnameValue = surnames[surnameIndex]
  return `${firstNameValue} ${surnameValue}`
}

function generateRandomDate () {
  const startDate = new Date(1950, 1, 1)
  const endDate = new Date(2017, 5, 5)
  const r = dateGenerator.getRandomDateInRange(startDate, endDate)
  return yyyymmdd(r)
}

function chainedError (err, msg) {
  err.message = `${msg}\nCaused by: ${err.message}`
  return err
}

function dumpTeiToConsole (createTeiData, context) {
  function l (msg) {
    console.log(`  ${msg}`)
  }
  console.log(chalk.green('## TEI dump:'))
  l(`type: ${createTeiData.trackedEntityType}`)
  l(`orgUnit: ${createTeiData.orgUnit}`)
  l(`attributes:`)
  for (let curr of createTeiData.attributes) {
    const attrDef = context.trackedEntityAttributes.vocab[curr.attribute]
    const name = attrDef.displayName
    const type = attrDef.type
    l(`  ${curr.attribute} ${name} (${type}) = ${curr.value}`)
  }
}
