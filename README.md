> tool for bulk creating trackedEntityInstances, for testing

## Quickstart

  1. clone this repo
  1. install dependencies
      ```bash
      yarn
      ```
  1. override the default config by creating a `config.js` file and overriding anything from `default-config.js`
      ```bash
      touch config.js
      cat default-config.js
      # anything you don't in default-config.js can be overridden in config.js
      ```
  1. run the script to create and enroll the number of TEIs (Tracked Entity Instances) specified by the count (default is 1)
      ```
      node index.js
      ```

## Deleting records
This script can also delete records all the records has created (based on the prefix to Full Name). You can run in `delete` mode with:

  1. clone and install deps as above
  1. make sure you override the config if required (see above for how to do this)
  1. run the script in delete mode
      ```bash
      node index.js delete
      ```
