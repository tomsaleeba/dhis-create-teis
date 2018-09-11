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
      ```
  1. run the script to create and enroll a TEI (Tracked Entity Instance)
      ```
      node index.js
      ```

