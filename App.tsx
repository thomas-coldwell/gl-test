import "react-native-console-time-polyfill";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef, useState } from "react";
import {
  Image,
  StyleSheet,
  Text,
  View,
  PixelRatio,
  TextInput,
  Button,
  Platform,
} from "react-native";
import { ExpoWebGLRenderingContext, GLView } from "expo-gl";
import { Asset } from "expo-asset";
import { Slider } from "@miblanchard/react-native-slider";
//@ts-ignore
import _ from "lodash";
import { Buffer } from "buffer";

const vertShader = `
precision highp float;
attribute vec2 position;
varying vec2 uv;
void main () {
  uv = position;
  gl_Position = vec4(1.0 - 2.0 * uv, 0, 1);
}`;

const fragShader = `
precision highp float;
precision highp int;
uniform sampler2D texture;
uniform highp float width;
uniform highp float height;
varying vec2 uv;
uniform highp int radius;
uniform highp int pass;

float gauss (float sigma, float x) {
  float g = (1.0/sqrt(2.0*3.142*sigma*sigma))*exp(-0.5*(x*x)/(sigma*sigma));
  return g;
}

void main () {
  float f_radius = float(radius);
  float sigma = ((0.5 * f_radius) + exp(-0.05 * f_radius));
  // Get the color of the fragment pixel
  vec4 color = texture2D(texture, vec2(uv.x, uv.y));
  color *= gauss(sigma, 0.0);

  for (int i = -50; i <= 50; i++) {
    if (i >= -radius && i <= radius) {
      float offset = float(i);
      // Caclulate the current pixel index
      float pixelIndex = 0.0;
      if (pass == 0) {
        pixelIndex = (uv.y) * height;
      }
      else {
        pixelIndex = uv.x * width;
      }
      // Get the neighbouring pixel index
      pixelIndex += offset;
      // Normalise the new index back into the 0.0 to 1.0 range
      if (pass == 0) {
        pixelIndex /= height;
      }
      else {
        pixelIndex /= width;
      }
      // Pad the UV 
      if (pixelIndex < 0.0) {
        pixelIndex = 0.0;
      }
      if (pixelIndex > 1.0) {
        pixelIndex = 1.0;
      }
      // Get gaussian amplitude
      float g = gauss(sigma, offset);
      // Get the color of neighbouring pixel
      vec4 previousColor = vec4(0.0, 0.0, 0.0, 0.0);
      if (pass == 0) {
        previousColor = texture2D(texture, vec2(uv.x, pixelIndex)) * g;
      }
      else {
        previousColor = texture2D(texture, vec2(pixelIndex, uv.y)) * g;
      }
      color += previousColor;
    }
  }

  // Return the resulting color
  gl_FragColor = color;
}`;

export default function App() {
  //
  const [img, setImg] = useState({});

  const glCtx = useRef<ExpoWebGLRenderingContext>();
  const glProgram = useRef<WebGLProgram>();
  const glVerts = useRef<Float32Array>();
  const originalImage = useRef<any>();

  const [blur, setBlur] = useState(40);

  const performBlur = async () => {
    _.throttle(
      async () => {
        // Get the GL context, program and verts from its initial setup
        const gl = glCtx.current;
        const program = glProgram.current;
        const verts = glVerts.current;
        const image = originalImage.current;
        // Check all are not null
        if (gl && program && verts && image) {
          // Perform seperate vertical and horizonal blur passes for
          // efficiency - http://rastergrid.com/blog/2010/09/efficient-gaussian-blur-with-linear-sampling/
          // Set the blur radius for the gaussian blur
          gl.uniform1i(gl.getUniformLocation(program, "texture"), 0);
          gl.uniform1i(gl.getUniformLocation(program, "radius"), blur);
          gl.uniform1i(gl.getUniformLocation(program, "pass"), 0);
          // Setup so first pass renders to a texture rather than to canvas
          // Create and bind the framebuffer
          const firstPassTexture = gl.createTexture();
          // Set the active texture to the texture 0 binding (0-30)
          gl.activeTexture(gl.TEXTURE1);
          // Bind the texture to WebGL stating what type of texture it is
          gl.bindTexture(gl.TEXTURE_2D, firstPassTexture);
          // Set some parameters for the texture
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          // Then set the data of this texture using texImage2D
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            image.width,
            image.height,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            null
          );
          const fb = gl.createFramebuffer();
          gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
          // attach the texture as the first color attachment
          const attachmentPoint = gl.COLOR_ATTACHMENT0;
          gl.framebufferTexture2D(
            gl.FRAMEBUFFER,
            attachmentPoint,
            gl.TEXTURE_2D,
            firstPassTexture,
            0
          );
          // Actually draw using the shader program we setup!
          gl.drawArrays(gl.TRIANGLES, 0, verts.length / 2);
          // Fab now we want to do a second pass - let's use the first pass
          // texture we just wrote to
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.uniform1i(gl.getUniformLocation(program, "texture"), 1);
          gl.uniform1i(gl.getUniformLocation(program, "pass"), 1);
          gl.drawArrays(gl.TRIANGLES, 0, verts.length / 2);
          gl.endFrameEXP();
        }
      },
      50,
      { leading: true }
    )();
  };

  const takeSnapshot = async () => {
    const gl = glCtx.current;
    const verts = glVerts.current;
    if (gl && verts) {
      gl.drawArrays(gl.TRIANGLES, 0, verts.length / 2);
      const output = await GLView.takeSnapshotAsync(gl);
      if (Platform.OS === "web") {
        const fileReaderInstance = new FileReader();
        fileReaderInstance.readAsDataURL(output.uri as any);
        fileReaderInstance.onload = () => {
          const base64data = fileReaderInstance.result;
          setImg({ uri: base64data });
        };
      } else {
        setImg(output);
      }
    }
  };

  useEffect(() => {
    if (!_.isEmpty(img)) {
      performBlur();
    }
  }, [blur]);

  useEffect(() => {
    const onContextCreate = async () => {
      // Load in the asset and get its height and width
      const asset = Asset.fromModule(require("./assets/test.jpg"));
      await asset.downloadAsync();
      if (asset.width && asset.height) {
        // Imperatively creat a GL instance
        const gl = await GLView.createContextAsync();
        // gl.clear(gl.COLOR_BUFFER_BIT);
        // gl.canvas.width = asset.width;
        // gl.canvas.height = asset.height;
        //gl.viewport(0, 0, asset.width, asset.height);
        //console.log(gl.drawingBufferHeight, gl.drawingBufferWidth);
        // Setup the shaders for our GL context so it draws from texImage2D
        const vert = gl.createShader(gl.VERTEX_SHADER);
        const frag = gl.createShader(gl.FRAGMENT_SHADER);
        if (vert && frag) {
          // Set the source of the shaders and compile them
          gl.shaderSource(vert, vertShader);
          gl.compileShader(vert);
          gl.shaderSource(frag, fragShader);
          gl.compileShader(frag);
          // Create a WebGL program so we can link the shaders together
          const program = gl.createProgram();
          if (program) {
            // Attach both the vertex and frag shader to the program
            gl.attachShader(program, vert);
            gl.attachShader(program, frag);
            // Link the program - ensures that vetex and frag shaders are compatible
            // with each other
            gl.linkProgram(program);
            // Tell GL we ant to now use this program
            gl.useProgram(program);
            // Create a buffer on the GPU and assign its type as array buffer
            const buffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            // Create the verticies for WebGL to form triangles on the screen
            // using the vertex shader which forms a square or rectangle in this case
            const verts = new Float32Array([
              -1,
              -1,
              1,
              -1,
              1,
              1,
              -1,
              -1,
              -1,
              1,
              1,
              1,
            ]);
            // Actually pass the verticies into the buffer and tell WebGL this is static
            // for optimisations
            gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
            // Get the index in memory for the position attribute defined in the
            // vertex shader
            const positionAttrib = gl.getAttribLocation(program, "position");
            gl.enableVertexAttribArray(positionAttrib); // Enable it i guess
            // Tell the vertex shader how to process this attribute buffer
            gl.vertexAttribPointer(positionAttrib, 2, gl.FLOAT, false, 0, 0);
            // Fetch an expo asset which can passed in as the source for the
            // texImage2D

            // Create some space in memory for a texture
            const texture = gl.createTexture();
            // Set the active texture to the texture 0 binding (0-30)
            gl.activeTexture(gl.TEXTURE0);
            // Bind the texture to WebGL stating what type of texture it is
            gl.bindTexture(gl.TEXTURE_2D, texture);
            // Set some parameters for the texture
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            // Then set the data of this texture using texImage2D
            gl.texImage2D(
              gl.TEXTURE_2D,
              0,
              gl.RGBA,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              asset as any
            );
            // Set a bunch of uniforms we want to pass into our fragement shader
            gl.uniform1i(gl.getUniformLocation(program, "texture"), 0);
            gl.uniform1f(gl.getUniformLocation(program, "width"), asset.width);
            gl.uniform1f(
              gl.getUniformLocation(program, "height"),
              asset.height
            );
            // Set some refs for things like the GL context, programs and verts we'll want
            // to use at draw time
            glCtx.current = gl;
            glProgram.current = program;
            glVerts.current = verts;
            originalImage.current = asset;
            await performBlur();
            await takeSnapshot();
          }
        }
      }
    };
    onContextCreate();
  }, []);

  return (
    <View style={styles.container}>
      <Image style={styles.image} source={require("./assets/test.jpg")} />
      <Slider
        value={blur}
        onValueChange={(value) =>
          setBlur(Math.round((value as unknown) as number))
        }
        minimumValue={1}
        maximumValue={50}
        containerStyle={{ width: 300 }}
        onSlidingComplete={() => takeSnapshot()}
      />
      {!_.isEmpty(img) && (
        <Image
          style={[styles.image, { transform: [{ scaleY: -1 }] }]}
          source={img}
        />
      )}
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
    height: 300,
    width: 500,
    margin: 5,
    resizeMode: "contain",
  },
});
