const axios = require('axios')
const async = require('async')
const VError = require('verror')
const chalk = require('chalk')
const dateGenerator = require('random-date-generator')
const yyyymmdd = require('yyyy-mm-dd')
const shortid = require('shortid')
const moment = require('moment')

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

let logFragmentForCreate = ''
if (runMode === 'create') {
  logFragmentForCreate = `
  recs: ${config.recordsToCreate} records will be created
  months back: ${config.startDataEntryMonthsBack}
  for months: ${config.dataEntryMonthCount}`
}
console.log(`Using config:
  url : ${apiUrl}
  user: ${config.username}
  pass: ${config.password}
  mode: ${runMode}${logFragmentForCreate}
  `)

const cache = {}

function httpConfig (extra) {
  const authConfig = {
    auth: {
      username: config.username,
      password: config.password
    }
  }
  if (!extra) {
    return authConfig
  }
  return Object.assign(authConfig, extra)
}

async function main () {
  const strategies = {
    create: createStrategy,
    delete: deleteStrategy
  }
  const strategy = strategies[runMode]
  if (!strategy) {
    console.error(`Unsupported runMode = '${runMode}', exiting.`)
  }
  let targetOrgUnits = config.targetOrgUnits
  if (targetOrgUnits === true) {
    info('looking up orgUnits from server')
    targetOrgUnits = await populateTargetOrgUnits()
    info(`found ${targetOrgUnits.length} orgUnits`)
  }
  try {
    await strategy(targetOrgUnits)
  } catch (err) {
    throw chainedError(err, `Failed to execute '${runMode}' strategy`)
  }
}
main().catch(err => {
  console.error(chalk.red('[ERROR] '), new VError(err))
  process.exit(1)
})


async function populateTargetOrgUnits () {
  try {
    const resp = await axios.get(`${apiUrl}/organisationUnits`, httpConfig({
      params: {
        filter: 'level:eq:5',
      },
      paging: false,
    }))
    if (!resp.data.organisationUnits || resp.data.organisationUnits.length === 0) {
      throw new Error(`request to get orgUnits from server succeeded but there are no items in the response, data=${JSON.stringify(resp.data)}`)
    }
    return resp.data.organisationUnits.map(e => e.id)
  } catch (err) {
    throw chainedError(err, 'failed while trying to get all level 5 orgUnits (empowerment groups)')
  }
}

function getOrgUnit (targetOrgUnits) {
  const index = Math.floor(Math.random() * targetOrgUnits.length)
  return targetOrgUnits[index]
}

async function getTrackedEntityAttributes () {
  let attributeIdsInProgram
  try {
    const resp = await axios.get(`${apiUrl}/programs/${config.targetProgram}`, httpConfig({
      params: {
        paging: false,
        fields: `programTrackedEntityAttributes[trackedEntityAttribute]`
      }
    }))
    attributeIdsInProgram = resp.data.programTrackedEntityAttributes.map(e => e.trackedEntityAttribute.id)
  } catch (err) {
    logAxiosError(err)
    throw chainedError(err, `Failed to get list of tracked entity attributes in the program='${config.targetProgram}'`)
  }
  try {
    const idFilter = attributeIdsInProgram.join(',')
    const resp = await axios.get(`${apiUrl}/trackedEntityAttributes`, httpConfig({
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
          const resp = await axios.get(`${apiUrl}/trackedEntityAttributes/${def.id}/generate`, httpConfig())
          return resp.data.value
        } catch (err) {
          throw new VError(err, `Failed to generate a '${def.displayName}' value. This happens sometimes, just try again.`)
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
        if (def.id === config.ctcAttributeId) {
          return generateCTC()
        }
        return shortid.generate()
      }
      return 'default value'
    },
    ORGANISATION_UNIT: def => {
      return def.orgUnit // asuming we need to be consistent and use the same orgUnit throughout for a single TEI
    },
    BOOLEAN: def => {
      return Math.random() > 0.5
    },
    NUMBER: def => {
      return Math.random() * 100
    },
    PHONE_NUMBER: def => {
      return '1234567890'
    },
    AGE: def => { // it's actually date of birth, not age
      return generateRandomDate()
    },
    DATE: def => {
      return generateRandomDate()
    },
    EMAIL: def => {
      return generateName() + "@gmail.com"
    }
  }
  return {
    trackedEntityAttributes: {
      vocab: teas,
      strategies: teaStrategies
    }
  }
}

async function createStrategy (targetOrgUnits) {
  const context = await generateContext()
  try {
    const promises = []
    for (let i = 0; i < config.recordsToCreate; i++) {
      promises.push(async function wrapper () {
        // DHIS generator seems to be time based so we need to go easy on it
        const waitMs = Math.floor(Math.random() * 50)
        await new Promise((resolve, reject) => {
          setTimeout(() => {
            return resolve()
          }, waitMs)
        })
        return createSingleRecord(context, i, targetOrgUnits)
      })
    }
    await new Promise((resolve, reject) => {
      async.parallelLimit(promises, config.parallelTaskCount, (err, results) => {
        if (err) {
          return reject(err)
        }
        return resolve(results)
      })
    })
  } catch (err) {
    throw new VError(err, `At least one record failed but others may have succeeded`)
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

async function createSingleRecord (context, index, targetOrgUnits) {
  info(`Creating record ${index + 1}/${config.recordsToCreate}`)
  const orgUnit = getOrgUnit(targetOrgUnits)
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
    const resp = await axios.post(`${apiUrl}/trackedEntityInstances`, createTeiData, httpConfig())
    teiId = resp.data.response.importSummaries[0].reference
  } catch (err) {
    logAxiosError(err)
    throw new VError(err, `Failed to create a trackedEntityInstance`)
  }
  // enroll trackedEntityInstance
  const enrollTeiData = {
    enrollmentDate: today(),
    incidentDate: today(),
    orgUnit: orgUnit,
    program: config.targetProgram,
    status: 'ACTIVE',
    trackedEntityInstance: teiId
  }
  info(`Enrolling TEI ${teiId}`)
  let enrollmentId
  try {
    const resp = await axios.post(`${apiUrl}/enrollments`, enrollTeiData, httpConfig())
    enrollmentId = resp.data.response.importSummaries[0].reference
  } catch (err) {
    throw new VError(err, `Failed to enroll TEI with ID='${teiId}'`)
  }
  info(`Created and enrolled ${teiId}, now generating events`)
  try {
    await generateEventData(teiId, orgUnit, enrollmentId)
  } catch (err) {
    throw new VError(err, 'Failed to generate event data')
  }
  return true
}

async function generateEventData (teiId, orgUnit, enrollmentId) {
  const eventDate = moment().subtract(config.startDataEntryMonthsBack, 'months')
  const events = []
  for (let i = 0; i < config.dataEntryMonthCount; i++) {
    const dataValues = await generateSetOfDataElements()
    eventDate.add(1, 'months') // note: moment mutates in place
    const event = {
      trackedEntityInstance: teiId,
      program: config.targetProgram,
      programStage: config.targetProgramStage,
      orgUnit,
      enrollment: enrollmentId,
      status: 'COMPLETED',
      dataValues,
      eventDate: eventDate.toISOString()
    }
    events.push(event)
  }
  try {
    info(`POSTing ${events.length} events for TEI='${teiId}'`)
    if (config.isTrace) {
      dumpEventsToConsole(events, teiId)
    }
    await axios.post(`${apiUrl}/events`, { events }, httpConfig())
  } catch (err) {
    throw new VError(err, `Failed to post events for tei='${teiId}'`)
  }
}

async function getDataElementDefs () {
  const cacheKey = 'dataElementDefs'
  let result = cache[cacheKey]
  if (result) {
    return result
  }
  try {
    const resp = await axios.get(`${apiUrl}/programStages/${config.targetProgramStage}`, httpConfig({
      params: {
        paging: false,
        fields: `
          programStageSections[
            dataElements[
              id,
              formName,
              displayName,
              valueType,
              optionSetValue,
              optionSet[
                id,
                options[
                  id,
                  displayName
                ]
              ]
            ]
          ]`.replace(/\s/g, '')
      }
    }))
    result = resp.data.programStageSections.reduce((accum, curr) => {
      return accum.concat(curr.dataElements)
    }, [])
  } catch (err) {
    throw new VError(err, 'Failed to get list of data element definitions from server')
  }
  cache[cacheKey] = result
  return result
}

async function generateSetOfDataElements () {
  const colTypeStrategies = {
    BOOLEAN_novocab: function (def) {
      return Math.random() > 0.5
    },
    TEXT_vocab: function (def) {
      const options = def.optionSet.options.map(e => e.code)
      const index = Math.floor(Math.random() * options.length)
      return options[index]
    },
    TEXT_novocab: function (def) {
      return 'free text ' + shortid.generate()
    },
    DATE_novocab: rawValue => {
      return generateRandomDate2018()
    }
  }
  const dataElementDefs = await getDataElementDefs()
  return dataElementDefs.map(def => {
    const vocabType = def.optionSetValue ? 'vocab' : 'novocab'
    const key = `${def.valueType}_${vocabType}`
    const strategy = colTypeStrategies[key]
    if (!strategy) {
      throw new Error(`Could not find a data element generator strategy for type='${key}'`)
    }
    const value = strategy(def)
    return {
      dataElement: def.id,
      value
    }
  })
}

function logAxiosError (err) {
  const errData = err && err.response && err.response.data
  if (!errData || typeof (errData) === 'string') {
    return
  }
  console.error('====================')
  console.error(errData.message)
  console.error(errData.response.importSummaries[0].conflicts)
  console.error('====================')
}

async function deleteStrategy (targetOrgUnits) {
  info('Gathering TEI IDs to delete')
  let teisToDelete
  try {
    const orgUnitIdList = targetOrgUnits.join(';')
    const resp = await axios.get(`${apiUrl}/trackedEntityInstances`, httpConfig({
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
  const deletePromises = teisToDelete.map(curr => axios.delete(`${apiUrl}/trackedEntityInstances/${curr}`, httpConfig()))
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

function padToFour (number) {
  if (number <= 9999) { number = ('000' + number).slice(-4) }
  return number
}

function padToTwo (number) {
  if (number <= 99) { number = ('0' + number).slice(-2) }
  return number
}

function generateCTC () {
  // not guaranteed to be unique but you're unlucky if it's not. Just run the program again
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

function today () {
  return yyyymmdd(new Date())
}

function generateRandomDate () {
  const startDate = new Date(1950, 1, 1)
  const endDate = new Date(2017, 5, 5)
  const r = dateGenerator.getRandomDateInRange(startDate, endDate)
  return yyyymmdd(r)
}

function generateRandomDate2018 () {
  const startDate = new Date(2018, 1, 1)
  const endDate = new Date(2018, 09, 31)
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

function dumpEventsToConsole (events, teiId) {
  function l (msg) {
    console.log(`  ${msg}`)
  }
  console.log(chalk.green(`## Events dump for TEI ${teiId} (count=${events.length}):`))
  let eventNum = 1
  events.sort((a, b) => {
    if (a.eventDate < b.eventDate) { return -1 }
    if (a.eventDate > b.eventDate) { return 1 }
    return 0
  })
  for (let curr of events) {
    l(`event ${eventNum++}`)
    l(`  eventDate: ${curr.eventDate}`)
    const values = curr.dataValues.map(e => e.value).join(',')
    l(`  values: ${values}`)
  }
}
