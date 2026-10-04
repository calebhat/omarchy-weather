const { test } = require("node:test")
const assert = require("node:assert/strict")
const { loadLibrary } = require("./load.js")

const Model = loadLibrary("Model.js")

test("negative fahrenheit gets the unicode minus sign", () => {
  assert.equal(Model.notificationTemp("-10°F"), "−10°F")
})

test("negative celsius gets the unicode minus sign", () => {
  assert.equal(Model.notificationTemp("-5°C"), "−5°C")
})

test("positive temperature is unchanged", () => {
  assert.equal(Model.notificationTemp("5°C"), "5°C")
})

test("empty string is unchanged", () => {
  assert.equal(Model.notificationTemp(""), "")
})

test("non-temperature strings are unchanged", () => {
  assert.equal(Model.notificationTemp("Wind 15 mph"), "Wind 15 mph")
})

test("result never starts with ascii hyphen", () => {
  var inputs = ["-10°F", "-5°C", "-0°F", "5°C", "", "text"]
  for (var i = 0; i < inputs.length; i++) {
    var result = Model.notificationTemp(inputs[i])
    var startsWithAsciiHyphen = result.length > 0 && result.charCodeAt(0) === 45
    assert.ok(!startsWithAsciiHyphen, inputs[i] + " -> " + result)
  }
})
