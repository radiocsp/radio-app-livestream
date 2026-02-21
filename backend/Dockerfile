FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine
RUN apk add --no-cache ffmpeg python3 py3-pip make g++ freetype fontconfig ttf-dejavu font-noto font-liberation ttf-freefont curl certbot docker-cli && \
    # Download Google Fonts
    mkdir -p /usr/share/fonts/google && \
    # Poppins (Canva favorite)
    curl -sL "https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-Regular.ttf" -o /usr/share/fonts/google/Poppins-Regular.ttf && \
    curl -sL "https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-Bold.ttf" -o /usr/share/fonts/google/Poppins-Bold.ttf && \
    curl -sL "https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-SemiBold.ttf" -o /usr/share/fonts/google/Poppins-SemiBold.ttf && \
    curl -sL "https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-Light.ttf" -o /usr/share/fonts/google/Poppins-Light.ttf && \
    curl -sL "https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-ExtraBold.ttf" -o /usr/share/fonts/google/Poppins-ExtraBold.ttf && \
    # League Spartan
    curl -sL "https://github.com/google/fonts/raw/main/ofl/leaguespartan/LeagueSpartan%5Bwght%5D.ttf" -o /usr/share/fonts/google/LeagueSpartan.ttf && \
    # Montserrat (Canva favorite)
    curl -sL "https://github.com/google/fonts/raw/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf" -o /usr/share/fonts/google/Montserrat.ttf && \
    # Oswald
    curl -sL "https://github.com/google/fonts/raw/main/ofl/oswald/Oswald%5Bwght%5D.ttf" -o /usr/share/fonts/google/Oswald.ttf && \
    # Raleway
    curl -sL "https://github.com/google/fonts/raw/main/ofl/raleway/Raleway%5Bwght%5D.ttf" -o /usr/share/fonts/google/Raleway.ttf && \
    # Roboto
    curl -sL "https://github.com/google/fonts/raw/main/ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf" -o /usr/share/fonts/google/Roboto.ttf && \
    # Open Sans
    curl -sL "https://github.com/google/fonts/raw/main/ofl/opensans/OpenSans%5Bwdth%2Cwght%5D.ttf" -o /usr/share/fonts/google/OpenSans.ttf && \
    # Lato
    curl -sL "https://github.com/google/fonts/raw/main/ofl/lato/Lato-Regular.ttf" -o /usr/share/fonts/google/Lato-Regular.ttf && \
    curl -sL "https://github.com/google/fonts/raw/main/ofl/lato/Lato-Bold.ttf" -o /usr/share/fonts/google/Lato-Bold.ttf && \
    # Bebas Neue (Canva favorite)
    curl -sL "https://github.com/google/fonts/raw/main/ofl/bebasneue/BebasNeue-Regular.ttf" -o /usr/share/fonts/google/BebasNeue-Regular.ttf && \
    # Playfair Display
    curl -sL "https://github.com/google/fonts/raw/main/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf" -o /usr/share/fonts/google/PlayfairDisplay.ttf && \
    # Inter
    curl -sL "https://github.com/google/fonts/raw/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf" -o /usr/share/fonts/google/Inter.ttf && \
    # Nunito
    curl -sL "https://github.com/google/fonts/raw/main/ofl/nunito/Nunito%5Bwght%5D.ttf" -o /usr/share/fonts/google/Nunito.ttf && \
    # Space Grotesk
    curl -sL "https://github.com/google/fonts/raw/main/ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf" -o /usr/share/fonts/google/SpaceGrotesk.ttf && \
    # Archivo Black
    curl -sL "https://github.com/google/fonts/raw/main/ofl/archivoblack/ArchivoBlack-Regular.ttf" -o /usr/share/fonts/google/ArchivoBlack-Regular.ttf && \
    # Anton
    curl -sL "https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf" -o /usr/share/fonts/google/Anton-Regular.ttf && \
    # Comfortaa
    curl -sL "https://github.com/google/fonts/raw/main/ofl/comfortaa/Comfortaa%5Bwght%5D.ttf" -o /usr/share/fonts/google/Comfortaa.ttf && \
    # Quicksand
    curl -sL "https://github.com/google/fonts/raw/main/ofl/quicksand/Quicksand%5Bwght%5D.ttf" -o /usr/share/fonts/google/Quicksand.ttf && \
    # Kanit
    curl -sL "https://github.com/google/fonts/raw/main/ofl/kanit/Kanit-Regular.ttf" -o /usr/share/fonts/google/Kanit-Regular.ttf && \
    curl -sL "https://github.com/google/fonts/raw/main/ofl/kanit/Kanit-Bold.ttf" -o /usr/share/fonts/google/Kanit-Bold.ttf && \
    # Refresh font cache
    fc-cache -f
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
RUN mkdir -p uploads data
EXPOSE 3001
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
