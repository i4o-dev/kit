import { assignPropsTo } from "../utils"

let displayChoices = (choices: Choice<any>[]) => {
  switch (typeof choices) {
    case "string":
      global.setPanel(choices)
      break

    case "object":
      global.setChoices(choices)
      break
  }
}

let fromInput = async (
  choices: (
    input: string
  ) => Promise<Choice<any>[]> | Choice<any>[],
  input: string
) => {
  displayChoices(await choices(input))
}

global.kitPrompt = async (config: PromptConfig) => {
  let {
    placeholder = "",
    validate = null,
    choices = [],
    secret = false,
    hint = "",
    input = "",
    drop = false,
  } = config

  global.setMode("FILTER")

  if (typeof choices === "function") {
    if (choices?.length === 0) {
      choices = await (choices as () => any)()
      // if (typeof choices?.then === "function") {
      //   choices = await choices
      // }
    } else {
      //When choices is a function with an argument
      global.setMode("GENERATE")
    }
  }

  let scriptInfo = await global.cli(
    "info",
    global.kitScript
  )

  global.send("SHOW_PROMPT", {
    tabs: global.onTabs?.length
      ? global.onTabs.map(({ name }) => name)
      : [],
    tabIndex: global.onTabs?.findIndex(
      ({ name }) => global.arg?.tab
    ),
    scriptInfo,
    placeholder,
    kitScript: global.kitScript,
    parentScript: global.env.KIT_PARENT_NAME,
    kitArgs: global.args.join(" "),
    secret,
    drop,
  })

  if (hint) global.setHint(hint)
  if (input) global.setInput(input)

  displayChoices(choices as any)

  let messageHandler: (data: any) => void
  let errorHandler: () => void

  let value = await new Promise((resolve, reject) => {
    messageHandler = async data => {
      //If you're typing input, send back choices based on the function

      switch (data?.channel) {
        case "GENERATE_CHOICES":
          if (
            typeof choices === "function" &&
            choices?.length > 0
          ) {
            fromInput(choices as any, data.input)
          }

          break

        case "TAB_CHANGED":
          if (data?.tab && global.onTabs) {
            process.off("message", messageHandler)
            process.off("error", errorHandler)
            let tabIndex = global.onTabs.findIndex(
              ({ name }) => {
                return name == data?.tab
              }
            )

            global.currentOnTab = global.onTabs[
              tabIndex
            ].fn(data?.input)
          }
          break

        case "VALUE_SUBMITTED":
          let { value } = data
          if (validate) {
            let validateMessage = await validate(value)

            if (typeof validateMessage === "string") {
              global.setPlaceholder(validateMessage)
              global.setChoices(global.kitPrevChoices)

              return
            }
          }
          resolve(value)
          break
      }
    }

    errorHandler = () => {
      reject()
    }

    process.on("message", messageHandler)
    process.on("error", errorHandler)
  })

  process.off("message", messageHandler)
  process.off("error", errorHandler)

  return value
}

global.arg = async (placeholderOrConfig, choices) => {
  let firstArg = global.args.length
    ? global.args.shift()
    : null
  let placeholderOrValidateMessage = ""
  if (firstArg) {
    let valid = true
    if (
      typeof placeholderOrConfig !== "string" &&
      placeholderOrConfig?.validate
    ) {
      let { validate } = placeholderOrConfig
      let validOrMessage = await validate(firstArg)
      valid =
        typeof validOrMessage === "boolean" &&
        validOrMessage

      if (typeof validOrMessage === "string")
        placeholderOrValidateMessage = validOrMessage
    }

    if (valid) {
      return firstArg
    }
  }

  if (typeof placeholderOrConfig === "undefined") {
    return await global.kitPrompt({
      placeholder: placeholderOrValidateMessage,
    })
  }

  if (typeof placeholderOrConfig === "string") {
    return await global.kitPrompt({
      placeholder: placeholderOrConfig,
      choices,
    })
  }

  return await global.kitPrompt({
    choices,
    ...placeholderOrConfig,
  })
}

global.updateArgs = arrayOfArgs => {
  let argv = require("minimist")(arrayOfArgs)
  global.args = [...global.args, ...argv._]
  global.argOpts = Object.entries(argv)
    .filter(([key]) => key != "_")
    .flatMap(([key, value]) => {
      if (typeof value === "boolean") {
        if (value) return [`--${key}`]
        if (!value) return [`--no-${key}`]
      }
      return [`--${key}`, value]
    })

  assignPropsTo(argv, global.arg)
}
global.updateArgs(process.argv.slice(2))

global.npm = async packageName => {
  try {
    return require(packageName)
  } catch {
    if (!global.arg?.trust) {
      let placeholder = `${packageName} is required for this script`

      let downloadsMessage = `${packageName} has had ${
        (
          await get(
            `https://api.npmjs.org/downloads/point/last-week/` +
              packageName
          )
        ).data.downloads
      } downloads from npm in the past week`

      let packageLink = `https://npmjs.com/package/${packageName}`

      let trust = await global.arg(
        { placeholder, hint: downloadsMessage },
        [
          {
            name: `Abort`,
            value: "false",
          },
          {
            name: `Install ${packageName}`,
            value: "true",
          },
          {
            name: `Visit ${packageLink}}`,
            value: "visit",
          },
        ]
      )
      if (trust === "visit") {
        exec(`open ${packageLink}`)
        exit()
      }

      if (trust === "false") {
        echo(`Ok. Exiting...`)
        exit()
      }
    }

    await global.cli("install", packageName)
    let packageJson = require(global.kenvPath(
      "node_modules",
      packageName,
      "package.json"
    ))

    return require(global.kenvPath(
      "node_modules",
      packageName,
      packageJson.main
    ))
  }
}

global.setPanel = async html => {
  global.send("SET_PANEL", { html })
}

global.setMode = async mode => {
  global.send("SET_MODE", {
    mode,
  })
}

global.setHint = async hint => {
  global.send("SET_HINT", {
    hint,
  })
}

global.setInput = async input => {
  global.send("SET_INPUT", {
    input,
  })
}

global.sendResponse = async value => {
  global.send("SEND_RESPONSE", {
    value,
  })
}
