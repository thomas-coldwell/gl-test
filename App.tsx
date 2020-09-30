import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef, useState } from "react";
import { Image, StyleSheet, Text, View, PixelRatio } from "react-native";
import { ExpoWebGLRenderingContext, GLView } from "expo-gl";
import { Asset } from "expo-asset";

const testImageUrl = "https://picsum.photos/id/1036/1280/720";

const vertShader = `
precision highp float;
attribute vec2 position;
varying vec2 uv;
void main () {
  uv = position;
  gl_Position = vec4(1.0 - 2.0 * position, 0, 1);
}`;

const fragShader = `
precision highp float;
uniform sampler2D texture;
uniform float width;
uniform float height;
varying vec2 uv;
uniform float radius;

float gauss (float x) {
  float sigma = (0.5 * radius);
  return (1.0/sqrt(2.0*3.142*sigma*sigma))*exp(-0.5*(x*x)/(sigma*sigma));
}

void main () {
  // Get the color of the fragment pixel
  vec4 color = texture2D(texture, vec2(uv.x, uv.y)) * gauss(0.0);

  int extent = int(radius);

  for (int j = -20; j <= 20; j++) {
    if (j >= -extent && j <= extent) {
    float f_j = float(j);
    float offset = f_j;
    // Caclulate the current pixel index
    float x = uv.x * width;
    // Get the neighbouring pixel index
    x += offset;
    // Normalise the new index back into the 0.0 to 1.0 range
    x /= width;
    // Get gaussian amplitude
    float g = gauss(offset);
    // Get the color of neighbouring pixel
    vec4 previousColor = texture2D(texture, vec2(x, uv.y)) * g;
    color += previousColor;
    }
  }

  // Average by 3 pixels
  gl_FragColor = color;
}`;

export default function App() {
  //
  const [img, setImg] = useState({});

  const onContextCreate = async (gl: ExpoWebGLRenderingContext) => {
    // Setup the shaders for our GL context so it draws from texImage2D
    const vert = gl.createShader(gl.VERTEX_SHADER);
    const frag = gl.createShader(gl.FRAGMENT_SHADER);
    if (vert && frag) {
      gl.shaderSource(vert, vertShader);
      gl.compileShader(vert);
      gl.shaderSource(frag, fragShader);
      gl.compileShader(frag);
      const program = gl.createProgram();
      if (program) {
        gl.attachShader(program, vert);
        gl.attachShader(program, frag);
        gl.linkProgram(program);
        gl.useProgram(program);
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        const verts = new Float32Array([-2, 0, 0, -2, 2, 2]);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
        const positionAttrib = gl.getAttribLocation(program, "position");
        gl.enableVertexAttribArray(positionAttrib);
        gl.vertexAttribPointer(positionAttrib, 2, gl.FLOAT, false, 0, 0);
        // Fetch an expo asset which can passed in as the source for the
        // texImage2D
        const asset = Asset.fromModule(require("./assets/test.jpg"));
        await asset.downloadAsync();
        if (asset.width && asset.height) {
          const texture = gl.createTexture();
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            asset as any
          );
          gl.uniform1i(gl.getUniformLocation(program, "texture"), 0);

          gl.uniform1f(gl.getUniformLocation(program, "width"), asset.width);
          gl.uniform1f(gl.getUniformLocation(program, "height"), asset.height);
          gl.uniform1f(gl.getUniformLocation(program, "radius"), 15.0);

          gl.clearColor(0, 0, 1, 1);
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
          gl.drawArrays(gl.TRIANGLES, 0, verts.length / 2);
          gl.endFrameEXP();

          const output = await GLView.takeSnapshotAsync(gl);
          console.log(output);
          var reader = new FileReader();
          reader.readAsDataURL(output.uri as Blob);
          reader.onloadend = function () {
            var base64data = reader.result;
            //console.log(base64data);
            setImg({ ...output, uri: base64data });
          };
        }
      }
    }
  };

  return (
    <View style={styles.container}>
      <Image style={styles.image} source={{ uri: testImageUrl }} />
      <GLView
        style={[styles.image, { opacity: 0.0, position: "absolute" }]}
        onContextCreate={onContextCreate}
      />
      <Image
        style={[styles.image, { transform: [{ scaleX: -1 }] }]}
        source={img}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  image: {
    height: 720 / PixelRatio.get(),
    width: 1280 / PixelRatio.get(),
    margin: 5,
    resizeMode: "contain",
  },
});
