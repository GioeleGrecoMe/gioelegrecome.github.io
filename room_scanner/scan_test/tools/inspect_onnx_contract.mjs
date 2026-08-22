#!/usr/bin/env node
// Tiny dependency-free ONNX graph-contract inspector.  It deliberately reads
// only ModelProto -> GraphProto -> ValueInfoProto, enough to verify that the
// browser worker and the bundled depth model agree before an inference starts.
import fs from 'node:fs';

const DATA_TYPES = {
  1: 'float32', 2: 'uint8', 3: 'int8', 4: 'uint16', 5: 'int16', 6: 'int32',
  7: 'int64', 9: 'bool', 10: 'float16', 11: 'float64', 12: 'uint32', 13: 'uint64',
  16: 'bfloat16',
};

function fail(message) { throw new Error(message); }

function readVarint(bytes, start) {
  let value = 0n;
  let shift = 0n;
  let at = start;
  while (at < bytes.length && shift <= 63n) {
    const byte = BigInt(bytes[at++]);
    value |= (byte & 0x7fn) << shift;
    if (!(byte & 0x80n)) return { value, at };
    shift += 7n;
  }
  fail(`varint non valido all'offset ${start}`);
}

function fields(bytes) {
  const out = [];
  let at = 0;
  while (at < bytes.length) {
    const key = readVarint(bytes, at); at = key.at;
    const field = Number(key.value >> 3n);
    const wire = Number(key.value & 7n);
    if (!field) fail(`field zero all'offset ${at}`);
    if (wire === 0) {
      const value = readVarint(bytes, at); at = value.at;
      out.push({ field, wire, value: value.value });
    } else if (wire === 1) {
      if (at + 8 > bytes.length) fail('fixed64 troncato');
      out.push({ field, wire, value: bytes.subarray(at, at + 8) }); at += 8;
    } else if (wire === 2) {
      const length = readVarint(bytes, at); at = length.at;
      const end = at + Number(length.value);
      if (end > bytes.length) fail('campo length-delimited troncato');
      out.push({ field, wire, value: bytes.subarray(at, end) }); at = end;
    } else if (wire === 5) {
      if (at + 4 > bytes.length) fail('fixed32 troncato');
      out.push({ field, wire, value: bytes.subarray(at, at + 4) }); at += 4;
    } else {
      fail(`wire type ONNX non gestito: ${wire}`);
    }
  }
  return out;
}

function text(bytes) { return new TextDecoder().decode(bytes); }
function first(list, field) { return list.find((entry) => entry.field === field); }
function all(list, field) { return list.filter((entry) => entry.field === field); }

function dimension(bytes) {
  const entries = fields(bytes);
  const numeric = first(entries, 1);
  if (numeric?.wire === 0) return Number(numeric.value);
  const symbolic = first(entries, 2);
  return symbolic?.wire === 2 ? text(symbolic.value) : null;
}

function tensorType(bytes) {
  const entries = fields(bytes);
  const element = first(entries, 1);
  const shape = first(entries, 2);
  const dimensions = shape?.wire === 2
    ? all(fields(shape.value), 1).filter((entry) => entry.wire === 2).map((entry) => dimension(entry.value))
    : null;
  return { dataType: DATA_TYPES[Number(element?.value)] || `onnx-${element?.value ?? '?'}`, shape: dimensions };
}

function valueInfo(bytes) {
  const entries = fields(bytes);
  const name = first(entries, 1);
  const type = first(entries, 2);
  const tensor = type?.wire === 2 ? first(fields(type.value), 1) : null;
  return {
    name: name?.wire === 2 ? text(name.value) : null,
    ...(tensor?.wire === 2 ? tensorType(tensor.value) : { dataType: null, shape: null }),
  };
}

function modelContract(file) {
  const root = fields(new Uint8Array(fs.readFileSync(file)));
  const graph = first(root, 7);
  if (!graph?.value) fail('GraphProto (field 7) assente');
  const entries = fields(graph.value);
  return {
    file,
    inputs: all(entries, 11).filter((entry) => entry.wire === 2).map((entry) => valueInfo(entry.value)),
    outputs: all(entries, 12).filter((entry) => entry.wire === 2).map((entry) => valueInfo(entry.value)),
  };
}

function isDepthAnythingContract(contract) {
  const input = contract.inputs.find((entry) => entry.name === 'pixel_values');
  const output = contract.outputs.find((entry) => entry.name === 'predicted_depth');
  const nchw = input?.dataType === 'float32' && input.shape?.length === 4
    && input.shape[1] === 3;
  const depth = output?.dataType === 'float32' && output.shape?.length === 3;
  return { ok: !!(nchw && depth), input, output };
}

const files = process.argv.slice(2);
if (!files.length) fail('uso: node inspect_onnx_contract.mjs <modello.onnx> [...]');
const contracts = files.map(modelContract);
for (const contract of contracts) {
  const check = isDepthAnythingContract(contract);
  console.log(JSON.stringify({ ...contract, depthAnythingV2Contract: check.ok }, null, 2));
  if (!check.ok) process.exitCode = 2;
}

export { modelContract, isDepthAnythingContract };
