export default (services: any) => ({
  callbacks: {
    'open-dashboard': () => {
      window.open('https://example.com/dashboard', '_blank');
    }
  }
});
