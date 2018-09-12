> tool for bulk creating trackedEntityInstances, for testing

## Quickstart

  1. clone this repo
  1. install dependencies
      ```bash
      yarn
      ```
  1. define some environment variables to override the defaults
      ```bash
      # replace with your values
      export DHIS_USER=someuser
      export DHIS_PASS=somepass
      export DHIS_RECORD_COUNT=100 # records to create
      ```
  1. run the script to create and enroll the number of TEIs (Tracked Entity Instances) specified by the count (default is 1)
      ```
      node index.js
      ```

## Deleting records
This script can also delete records all the records has created (based on the prefix to Full Name). You can run in `delete` mode with:

  1. clone and install deps as above
  1. define some environment variables to override the defaults
      ```bash
      # replace with your values
      export DHIS_USER=someuser
      export DHIS_PASS=somepass
      ```
  1. run the script in delete mode
      ```bash
      node index.js delete
      ```
